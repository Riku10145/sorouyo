import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import { toast } from '../../../components/Toaster';
import { toJst } from '../../../lib/date';
import { issueGroupInvite, revokeGroupInvite, type GroupDetail as Detail } from '../api';

export function GroupMembers({ detail }: { detail: Detail }) {
  const { group, members } = detail;
  const [joinInvite, setJoinInvite] = useState(detail.joinInvite);
  const admin = group.role === 'admin';
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteConfirming, setInviteConfirming] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
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

  const inviteStateText = joinInvite ? { active: '有効', expired: '期限切れ', revoked: '無効化済み' }[joinInvite.state] : null;
  const inviteExpiry = joinInvite?.expiresAt ? toJst(joinInvite.expiresAt) : null;

  return <section className="card">
    <h2>メンバー</h2>
    <ul className="member-list">
      {members.map(member => <li key={member.id} className="member-row">
        <span className="member-name">{member.name}{member.you && <span className="role-badge">あなた</span>}</span>
        <span className="role-badge">{member.role === 'admin' ? '管理者' : 'メンバー'}</span>
      </li>)}
    </ul>
    {admin && <>
      <p className="hint">参加リンクを送ると、リンクを受け取った人がこのグループに参加できます。リンクは7日間有効で、有効なリンクは1グループ1本です。</p>
      {joinInvite
        ? <p className="hint">現在のリンク: {inviteStateText}{inviteExpiry && joinInvite.state !== 'revoked' ? `（期限: ${inviteExpiry.date} ${inviteExpiry.time}）` : ''}</p>
        : <p className="hint">参加リンクはまだ発行されていません。</p>}
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
