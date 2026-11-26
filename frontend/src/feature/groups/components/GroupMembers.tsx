import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import { toast } from '../../../components/Toaster';
import { toJst } from '../../../lib/date';
import { issueGroupInvite, removeGroupMember, revokeGroupInvite, type GroupDetail as Detail } from '../api';

type Member = Detail['members'][number];

export function GroupMembers({ detail, onChange }: { detail: Detail; onChange: (detail: Detail) => void }) {
  const { group, members } = detail;
  const [joinInvite, setJoinInvite] = useState(detail.joinInvite);
  const admin = group.role === 'admin';
  const viewer = members.find(member => member.you);
  const viewerCreator = viewer?.id !== undefined && viewer.id === detail.creatorId;
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteConfirming, setInviteConfirming] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [memberConfirming, setMemberConfirming] = useState<Member | null>(null);
  const [memberBusy, setMemberBusy] = useState(false);
  const [linkRenewalNotice, setLinkRenewalNotice] = useState(false);
  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast('招待リンクをコピーしました');
    } catch {
      window.prompt('招待リンクをコピーしてください', inviteUrl);
    }
  };

  const reissueInvite = async () => {
    setInviteBusy(true);
    const issued = await issueGroupInvite(group.id);
    setInviteBusy(false);
    if (!issued) { toast('招待リンクを作れませんでした'); return; }
    setInviteUrl(`${window.location.origin}/join#${issued.token}`);
    setJoinInvite(issued.invite);
    setInviteConfirming(false);
    setLinkRenewalNotice(false);
    toast('参加リンクを再発行しました');
  };

  const revokeInvite = async () => {
    if (!joinInvite) return;
    setInviteBusy(true);
    const revoked = await revokeGroupInvite(group.id, joinInvite.id);
    setInviteBusy(false);
    if (!revoked) { toast('参加リンクを無効化できませんでした'); return; }
    setInviteUrl(null);
    setJoinInvite(revoked);
    setInviteConfirming(false);
    toast('参加リンクを無効化しました');
  };

  const removeMember = async (member: Member) => {
    setMemberBusy(true);
    const ok = await removeGroupMember(group.id, member.id);
    setMemberBusy(false);
    if (!ok) {
      toast(member.you ? '脱退できませんでした' : 'メンバーを除名できませんでした');
      return;
    }
    setMemberConfirming(null);
    if (member.you) {
      toast(`「${group.name}」から脱退しました`);
      window.location.href = '/groups';
      return;
    }
    const remaining = detail.members.filter(row => row.id !== member.id);
    const nextJoinInvite = joinInvite ? { ...joinInvite, state: 'revoked' as const } : joinInvite;
    onChange({
      ...detail,
      members: remaining,
      counts: { ...detail.counts, members: remaining.length },
      joinInvite: nextJoinInvite,
    });
    setJoinInvite(nextJoinInvite);
    setInviteUrl(null);
    setLinkRenewalNotice(Boolean(joinInvite));
    toast(`${member.name}を除名しました`);
  };

  const inviteStateText = joinInvite ? { active: '有効', expired: '期限切れ', revoked: '無効化済み' }[joinInvite.state] : null;
  const inviteExpiry = joinInvite?.expiresAt ? toJst(joinInvite.expiresAt) : null;

  return <section className="card">
    <h2>メンバー</h2>
    <ul className="member-list">
      {members.map(member => {
        const canRemove = viewerCreator && !member.you;
        const canLeave = member.you && !viewerCreator;
        return <li key={member.id} className="member-row">
          <span className="member-name">{member.name}{member.you && <span className="role-badge">あなた</span>}</span>
          <span className="member-side">
            <span className="role-badge">{member.role === 'admin' ? '管理者' : 'メンバー'}</span>
            {canRemove && <button type="button" className="text-btn danger" onClick={() => setMemberConfirming(member)}>除名</button>}
            {canLeave && <button type="button" className="text-btn danger" onClick={() => setMemberConfirming(member)}>脱退</button>}
          </span>
        </li>;
      })}
    </ul>
    {memberConfirming && <div className="notice-card" role="alertdialog" aria-label={memberConfirming.you ? '脱退の確認' : '除名の確認'}>
      <p>{memberConfirming.you
        ? `「${group.name}」から脱退します。グループの予定や日程調整は見られなくなります。`
        : `${memberConfirming.name}を除名します。この人が入れた予定や回答は残ります。現在の参加リンクも無効化されます。`}</p>
      <div className="about-actions">
        <button type="button" className="ghost-btn" onClick={() => setMemberConfirming(null)}>キャンセル</button>
        <button type="button" className="primary-btn danger" disabled={memberBusy} onClick={() => void removeMember(memberConfirming)}>
          {memberBusy ? '処理中…' : memberConfirming.you ? '脱退する' : '除名する'}
        </button>
      </div>
    </div>}
    {admin && <>
      <p className="hint">参加リンクを送ると、リンクを受け取った人がこのグループに参加できます。リンクは7日間有効で、有効なリンクは1グループ1本です。</p>
      {joinInvite
        ? <p className="hint">現在のリンク: {inviteStateText}{inviteExpiry && joinInvite.state !== 'revoked' ? `（期限: ${inviteExpiry.date} ${inviteExpiry.time}）` : ''}</p>
        : <p className="hint">参加リンクはまだ発行されていません。</p>}
      {linkRenewalNotice && <p className="hint">除名にあわせて参加リンクを無効化しました。引き続き使う場合は再発行してください。</p>}
      {inviteUrl && joinInvite?.state === 'active' && <p className="copy-line">
        <input readOnly value={inviteUrl} onFocus={e => e.target.select()} aria-label="参加リンク" />
        <button type="button" className="soft-btn" onClick={() => void copyInvite()}><Icon name="copy" size={16} />コピー</button>
      </p>}
      {!inviteUrl && joinInvite?.state === 'active' && <p className="hint">発行済みのリンクは再表示できません。コピーし直す必要がある場合は再発行してください。</p>}
      {inviteConfirming && joinInvite ? <div className="notice-card" role="alertdialog" aria-label="参加リンクの無効化確認">
        <p>現在の参加リンクを無効化します。すでに共有したリンクからは参加できなくなります。</p>
        <div className="about-actions">
          <button type="button" className="ghost-btn" onClick={() => setInviteConfirming(false)}>キャンセル</button>
          <button type="button" className="primary-btn danger" disabled={inviteBusy} onClick={() => void revokeInvite()}>{inviteBusy ? '無効化中…' : '無効化する'}</button>
        </div>
      </div> : null}
      <div className="about-actions">
        {joinInvite?.state === 'active' && !inviteConfirming && <button type="button" className="ghost-btn danger" onClick={() => setInviteConfirming(true)}>無効化</button>}
        <button type="button" className="soft-btn" disabled={inviteBusy} onClick={() => void reissueInvite()}>
          <Icon name="link" size={18} />{joinInvite ? 'リンクを再発行' : '参加リンクを作成'}
        </button>
      </div>
      {joinInvite?.state === 'active' && <p className="hint">再発行すると現在のリンクは無効になります。発行直後のリンクはこの画面から何度でもコピーできます。</p>}
    </>}
  </section>;
}
