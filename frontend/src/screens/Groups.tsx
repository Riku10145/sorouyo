import { useEffect, useState, type FormEvent } from 'react';
import { useMe, fetchGroups, fetchGroup, createGroup, updateGroup, deleteGroup, issueGroupInvite, revokeGroupInvite, toJst, type GroupDetail as Detail, type GroupInfo } from '../api';
import { Brand, Icon, Dot, toast, GROUP_COLORS, DEFAULT_GROUP_COLOR, type DisplayGroup } from '../design/ui';
import { AppShell } from './Shell';
import { LoginCard } from './Auth';
import { GROUP_CREATE_FREE_NOTICE } from '../lib/planCopy';
import { GROUP_CREATION_LIMIT } from '../../../shared/schema';

/** 名前+色の入力フォーム。エラー時も入力した名前を消さない */
export function GroupForm({ initial, submitLabel, onSubmit, onCancel, showFreeNotice = false }: {
  initial?: { name: string; color: string | null };
  submitLabel: string;
  onSubmit: (name: string, color: string) => Promise<string | null>;
  onCancel?: () => void;
  showFreeNotice?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? DEFAULT_GROUP_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('グループ名を入力してください'); return; }
    setBusy(true);
    const message = await onSubmit(name.trim(), color).catch(() => '保存できませんでした');
    setBusy(false);
    if (message) { setError(message); return; }
    if (!initial) { setName(''); setColor(DEFAULT_GROUP_COLOR); }
    setError(null);
  };

  return <form className="group-form" onSubmit={submit} aria-label="グループの入力">
    <label className="field">グループ名
      <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="例：家族、いつメン" aria-invalid={!!error} />
    </label>
    <fieldset className="field">
      <legend>色</legend>
      <div className="color-swatches" role="radiogroup">
        {GROUP_COLORS.map(item => <button key={item.value} type="button" role="radio" aria-checked={color === item.value}
          className={`swatch${color === item.value ? ' on' : ''}`} style={{ background: item.value }} onClick={() => setColor(item.value)}
          aria-label={`色 ${item.value}`} />)}
      </div>
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    {showFreeNotice && <p className="hint">{GROUP_CREATE_FREE_NOTICE}</p>}
    <div className="about-actions">
      {onCancel && <button type="button" className="ghost-btn" onClick={onCancel}>キャンセル</button>}
      <button type="submit" className="primary-btn" disabled={busy}>{busy ? '保存中…' : submitLabel}</button>
    </div>
  </form>;
}

/** /groups グループ一覧と作成 */
export function Groups() {
  const me = useMe();
  const wantsCreate = new URLSearchParams(window.location.search).get('create') === '1';
  const [groups, setGroups] = useState<GroupInfo[] | 'error' | null>(null);
  const [creating, setCreating] = useState(wantsCreate);
  const loginNext = wantsCreate ? '/groups?create=1' : '/groups';

  useEffect(() => {
    if (!me) return;
    void fetchGroups().then(list => setGroups(list ?? 'error'));
  }, [me]);

  if (me === undefined) return null;
  if (me === null) {
    return <AppShell active="groups" selectedDate="" groups={[]} subpage>
      <LoginCard next={loginNext} />
    </AppShell>;
  }

  return <AppShell active="groups" selectedDate="" groups={[]}>
    <header className="m-header"><Brand /><a className="text-btn" href="/settings"><Icon name="settings" size={20} />設定</a></header>
    <h1 className="page-title">グループ</h1>
    <div className="groups-body">
      {groups === 'error' ? <p className="form-error" role="alert">読み込めませんでした。時間をおいて再度お試しください。</p>
        : groups === null ? <p className="loading-note">読み込み中…</p> : <>
        {groups.length === 0 && !creating && <section className="empty-hero">
          <h2>まだグループがありません</h2>
          <p>家族や仲間ごとにグループを作ると、予定が色分けされて見やすくなります。</p>
        </section>}
        <ul className="group-list">
          {groups.map(group => <li key={group.id}>
            <a className="group-row card" href={`/groups/${group.id}`}>
              <Dot group={group} />
              <span className="group-row-main"><strong>{group.name}</strong><span className="role-badge">{group.role === 'admin' ? '管理者' : 'メンバー'}</span></span>
              <Icon name="chevronRight" size={18} />
            </a>
          </li>)}
        </ul>
        {creating
          ? <section className="card group-create"><h2>グループを作成</h2>
            <GroupForm submitLabel="作成する" showFreeNotice onSubmit={async (name, color) => {
              const created = await createGroup(name, color);
              if (created.status === 409) return `作成できるグループは${GROUP_CREATION_LIMIT}件までです。一覧から不要なグループを開き、作成済みが${GROUP_CREATION_LIMIT - 1}件以下になるまで削除すると、また作成できます。`;
              if (!created.group) return '作成できませんでした';
              toast('グループを作成しました');
              window.location.href = `/groups/${created.group.id}`;
              return null;
            }} />
          </section>
          : <button type="button" className="primary-btn wide" onClick={() => setCreating(true)}><Icon name="plus" size={18} />グループを作成</button>}
      </>}
    </div>
  </AppShell>;
}

/** /groups/<id> グループ詳細: 編集・メンバー・招待・削除 */
export function GroupDetail({ id, selectedDate }: { id: string; selectedDate: string }) {
  const me = useMe();
  const [detail, setDetail] = useState<Detail | 'loading' | 'denied'>('loading');
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteConfirming, setInviteConfirming] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me) return;
    let active = true;
    fetchGroup(id).then(({ detail }) => {
      if (!active) return;
      setDetail(detail ?? 'denied');
    }).catch(() => { if (active) setDetail('denied'); });
    return () => { active = false; };
  }, [id, me]);

  if (me === undefined) return null;
  if (me === null) {
    return <AppShell active="groups" selectedDate={selectedDate} groups={[]} subpage>
      <LoginCard next={`/groups/${id}`} />
    </AppShell>;
  }
  if (detail === 'loading') return null;
  if (detail === 'denied') {
    return <AppShell active="groups" selectedDate={selectedDate} groups={[]} subpage>
      <section className="notice-card" role="alert" style={{ margin: '24px 16px' }}>
        <Icon name="link" size={32} /><h2>グループを開けません</h2>
        <p>権限がないか、削除された可能性があります。</p>
        <a className="soft-btn" href="/groups">グループ一覧へ</a>
      </section>
    </AppShell>;
  }

  const { group, members, counts, joinInvite } = detail;
  const display: DisplayGroup = group;
  const admin = group.role === 'admin';

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
    setDetail({ ...detail, joinInvite: issued.invite });
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
    setDetail({ ...detail, joinInvite: revoked });
    setInviteConfirming(false);
    toast('参加リンクを無効化しました');
  };

  const remove = async () => {
    setBusy(true);
    const ok = await deleteGroup(group.id);
    setBusy(false);
    if (!ok) { toast('削除できませんでした'); return; }
    toast(`「${group.name}」を削除しました`);
    window.location.href = '/groups';
  };

  const inviteStateText = joinInvite ? { active: '有効', expired: '期限切れ', revoked: '無効化済み' }[joinInvite.state] : null;
  const inviteExpiry = joinInvite?.expiresAt ? toJst(joinInvite.expiresAt) : null;

  return <AppShell active="groups" selectedDate={selectedDate} groups={[display]} subpage>
    <div className="m-only m-back"><a className="text-btn" href="/groups"><Icon name="chevronLeft" size={20} />グループ</a></div>
    <div className="groups-body">
      <section className="card group-head">
        <h1><Dot group={display} />{group.name}</h1>
        <p>{counts.members}人のメンバー ・ 予定{counts.events}件 ・ 日程調整{counts.polls}件</p>
      </section>

      {admin && <section className="card">
        <h2>グループを編集</h2>
        {editing
          ? <GroupForm initial={{ name: group.name, color: group.color }} submitLabel="保存する" onSubmit={async (name, color) => {
            const updated = await updateGroup(group.id, name, color);
            if (!updated) return '保存できませんでした';
            setDetail({ ...detail, group: { ...group, name: updated.name, color: updated.color } });
            setEditing(false);
            toast('グループを更新しました');
            return null;
          }} onCancel={() => setEditing(false)} />
          : <button type="button" className="ghost-btn" onClick={() => setEditing(true)}><Icon name="settings" size={18} />名前・色を変更</button>}
      </section>}

      <section className="card">
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
      </section>

      {admin && <section className="card danger-zone">
        <h2>グループを削除</h2>
        {confirming ? <>
          <p>「<strong>{group.name}</strong>」を削除します。所属する予定{counts.events}件・日程調整{counts.polls}件・参加リンクがすべて消え、元に戻せません。</p>
          <div className="about-actions">
            <button type="button" className="ghost-btn" onClick={() => setConfirming(false)}>キャンセル</button>
            <button type="button" className="primary-btn danger" disabled={busy} onClick={() => void remove()}>{busy ? '削除中…' : '削除する'}</button>
          </div>
        </> : <button type="button" className="ghost-btn danger" onClick={() => setConfirming(true)}>削除する…</button>}
      </section>}
    </div>
  </AppShell>;
}
