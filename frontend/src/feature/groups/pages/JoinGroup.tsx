import { useEffect, useState } from 'react';
import { Brand } from '../../../components/Brand';
import { GuestFrame } from '../../../components/GuestFrame';
import { Icon } from '../../../components/Icon';
import { useHashToken } from '../../../hooks/useHashToken';
import { useMe } from '../../../hooks/useMe';
import { previewJoin, type JoinPreview } from '../api';
import { GroupInvitation } from '../components/GroupInvitation';

export function JoinGroup() {
  const token = useHashToken();
  const me = useMe();
  const [preview, setPreview] = useState<JoinPreview | 'loading' | 'invalid'>('loading');

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

  return <GroupInvitation key={token} preview={preview} token={token} loggedIn={me !== null} onInvalid={() => setPreview('invalid')} />;
}
