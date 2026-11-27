import { Brand } from './Brand';
import { Icon } from './Icon';

export function MobileHeader() {
  return <header className="m-header">
    <Brand />
    <a className="text-btn" href="/settings"><Icon name="settings" size={20} />設定</a>
  </header>;
}
