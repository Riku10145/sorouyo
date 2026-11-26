import { Brand } from '../../../components/Brand';
import { GuestFrame } from '../../../components/GuestFrame';
import { Icon } from '../../../components/Icon';
import { AccountSettings } from '../components/AccountSettings';

export function Settings() {
  return <GuestFrame>
    <header className="guest-header"><Brand size={28} sub="設定" /></header>
    <h1 className="page-title">設定</h1>
    <AccountSettings />
    <a className="about-row card" href="/"><span><strong>ホームへ戻る</strong></span><Icon name="chevronRight" size={18} /></a>
  </GuestFrame>;
}
