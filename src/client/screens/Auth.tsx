import { useState } from 'react';
import { Icon } from '../design/ui';

/** ログイン未設定環境では /api/auth/login が503を返すので、遷移前に確かめる（Settingsと同じ手順） */
export function LoginLink({ next, className = 'primary-btn', children }: { next?: string; className?: string; children: React.ReactNode }) {
  const [unavailable, setUnavailable] = useState(false);
  const href = `/api/auth/login${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  const login = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    try {
      const res = await fetch(href, { redirect: 'manual' });
      if (res.status === 503) { setUnavailable(true); return; }
      window.location.href = href;
    } catch {
      window.location.href = href;
    }
  };
  return <>
    <a className={className} href={href} onClick={event => void login(event)}>{children}</a>
    {unavailable && <p className="form-error" role="alert">ログイン機能はまだ設定されていません。</p>}
  </>;
}

/** ログインが必要な画面で出すカード */
export function LoginCard({ next, note }: { next?: string; note?: string }) {
  return <section className="notice-card" role="alert" style={{ margin: '24px 16px' }}>
    <Icon name="link" size={32} />
    <h2>ログインが必要です</h2>
    <p>{note ?? 'このページはログインしたメンバーだけが見られます。'}</p>
    <LoginLink next={next} className="soft-btn"><Icon name="settings" size={18} />ログイン</LoginLink>
  </section>;
}
