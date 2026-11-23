import { useEffect, useState } from 'react';
import { Brand, Icon, Dot, type DisplayGroup } from '../design/ui';
import { previewJoin, joinGroup, useMe, type JoinPreview } from '../api';
import { GuestFrame, useHashToken } from './GuestAnswer';
import { LoginLink } from './Auth';
import { dateLabel } from '../../shared/model';

/** /join#<token> 参加リンクの受け取り画面（#25） */
export function JoinGroup() {
  const token = useHashToken();
  const me = useMe();
  const [preview, setPreview] = useState<JoinPreview | 'loading' | 'invalid'>('loading');
  const [joined, setJoined] = useState<{ name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setPreview('invalid'); return; }
    let active = true;
    previewJoin(token).then(found => { if (active) setPreview(found ?? 'invalid'); })
      .catch(() => { if (active) setPreview('invalid'); });
    return () => { active = false; };
  }, [token]);

  if (preview === 'loading' || me === undefined) {
    return <GuestFrame><header className="guest-header"><Brand size={28} /></header></GuestFrame>;
  }

  if (preview === 'invalid') {
    return <GuestFrame><header className="guest-header"><Brand size={28} /></header>
      <h1 className="page-title">招待を開けません</h1>
      <section className="notice-card"><Icon name="link" size={32} />
        <p>この参加リンクは無効か、期限切れです。グループの管理者に新しいリンクをもらってください。</p>
        <a className="text-btn" href="/">ホームへ戻る</a>
      </section>
    </GuestFrame>;
  }

  const group: DisplayGroup = { id: preview.group.id, name: preview.group.name, color: preview.group.color };

  const join = async () => {
    setBusy(true);
    const result = await joinGroup(token);
    setBusy(false);
    if (result.status === 'joined') { setJoined({ name: result.group.name }); return; }
    if (result.status === 'invalid') { setPreview('invalid'); return; }
    if (result.status === 'login') { setError('ログインが必要です'); return; }
    setError('参加できませんでした。時間をおいてもう一度お試しください。');
  };

  if (joined) {
    return <GuestFrame><header className="guest-header"><Brand size={28} /></header>
      <h1 className="page-title">参加しました</h1>
      <section className="invite-card">
        <h2><Dot group={group} />{joined.name}</h2>
        <p className="strong">グループの予定がカレンダーに表示されます。</p>
      </section>
      <a className="primary-btn wide" href="/">カレンダーを開く</a>
    </GuestFrame>;
  }

  const next = `/join#${token}`;
  return <GuestFrame><header className="guest-header"><Brand size={28} /></header>
    <h1 className="page-title">グループへの招待</h1>
    <section className="invite-card">
      <p className="eyebrow">{preview.inviterName ? `${preview.inviterName}さんからの招待` : 'グループへの招待'}</p>
      <h2><Dot group={group} />{preview.group.name}</h2>
      <p className="strong">メンバー {preview.memberCount}人</p>
      {preview.upcoming.length > 0 && <>
        <p className="join-note">参加すると見える予定</p>
        <ul className="join-upcoming">
          {preview.upcoming.map((event, i) => <li key={i}><span className="num">{dateLabel(event.date)}</span>{event.title}</li>)}
        </ul>
      </>}
      <p className="join-note">参加するとこのグループの予定と日程調整が見られるようになります。</p>
    </section>
    {preview.member
      ? <><p className="join-note">すでにこのグループに参加しています。</p><a className="primary-btn wide" href="/">カレンダーを開く</a></>
      : me === null
        ? <LoginLink next={next} className="primary-btn wide">ログインして参加する</LoginLink>
        : <>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="button" className="primary-btn wide" disabled={busy} onClick={() => void join()}>{busy ? '参加中…' : 'このグループに参加する'}</button>
        </>}
    <p className="join-note"><a href="/">そろうよ ホームへ</a></p>
  </GuestFrame>;
}
