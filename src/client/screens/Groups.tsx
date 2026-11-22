import { useEffect, useState, type FormEvent } from 'react';
import { useMe, fetchGroups, fetchGroup, createGroup, updateGroup, deleteGroup, issueGroupInvite, type GroupDetail as Detail, type GroupInfo } from '../api';
import { Brand, Icon, Dot, toast, GROUP_COLORS, DEFAULT_GROUP_COLOR, type DisplayGroup } from '../design/ui';
import { AppShell } from './Shell';
import { LoginCard } from './Auth';

/** 名前+色の入力フォーム。エラー時も入力した名前を消さない */
export function GroupForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial?: { name: string; color: string | null };
  submitLabel: string;
  onSubmit: (name: string, color: string) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? DEFAULT_GROUP_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('グループ名を入力してください'); return; }
    setBusy(true);
    const message = await onSubmit(name.trim(), color);
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
    <div className="about-actions">
      {onCancel && <button type="button" className="ghost-btn" onClick={onCancel}>キャンセル</button>}
      <button type="submit" className="primary-btn" disabled={busy}>{busy ? '保存中…' : submitLabel}</button>
    </div>
  </form>;
}

/** /groups グループ一覧と作成 */
export function Groups() {
  const me = useMe();
  const [groups, setGroups] = useState<GroupInfo[] | 'error' | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!me) return;
    void fetchGroups().then(list => setGroups(list ?? 'error'));
  }, [me]);

  if (me === undefined) return null;
  if (me === null) {
    return <AppShell active="groups" selectedDate="" groups={[]} subpage>
      <LoginCard next="/groups" />
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
            <GroupForm submitLabel="作成する" onSubmit={async (name, color) => {
              const group = await createGroup(name, color);
              if (!group) return '作成できませんでした';
              toast('グループを作成しました');
              window.location.href = `/groups/${group.id}`;
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

  if (me === undefined || detail === 'loading') return null;
  if (me === null) {
    return <AppShell active="groups" selectedDate={selectedDate} groups={[]} subpage>
      <LoginCard next={`/groups/${id}`} />
    </AppShell>;
  }
  if (detail === 'denied') {
    return <AppShell active="groups" selectedDate={selectedDate} groups={[]} subpage>
      <section className="notice-card" role="alert" style={{ margin: '24px 16px' }}>
        <Icon name="link" size={32} /><h2>グループを開けません</h2>
        <p>権限がないか、削除された可能性があります。</p>
        <a className="soft-btn" href="/groups">グループ一覧へ</a>
      </section>
    </AppShell>;
  }

  const { group, members, counts } = detail;
  const display: DisplayGroup = group;
  const admin = group.role === 'admin';

  const copyInvite = async () => {
    const token = await issueGroupInvite(group.id);
    if (!token) { toast('招待リンクを作れませんでした'); return; }
    const url = `${window.location.origin}/join#${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('招待リンクをコピーしました');
    } catch {
      window.prompt('招待リンクをコピーしてください', url);
    }
  };

  const remove = async () => {
    setBusy(true);
    const ok = await deleteGroup(group.id);
    setBusy(false);
    if (!ok) { toast('削除できませんでした'); return; }
    toast(`「${group.name}」を削除しました`);
    window.location.href = '/groups';
  };

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
        {admin && <p className="hint">参加リンクを送ると、リンクを受け取った人がこのグループに参加できます。</p>}
        {admin && <button type="button" className="soft-btn" onClick={() => void copyInvite()}><Icon name="link" size={18} />参加リンクをコピー</button>}
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
