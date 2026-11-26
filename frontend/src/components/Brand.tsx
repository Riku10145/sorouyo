import { Icon } from './Icon';

export function Brand({ size = 36, sub }: { size?: number; sub?: string }) {
  return <a className="brand" href="/" aria-label="そろうよ ホーム">
    <span className="brand-mark" style={{ width: size, height: size }}><Icon name="brand" size={Math.round(size * 0.6)} /></span>
    <span className="brand-name">そろうよ</span>
    {sub && <span className="brand-sub">{sub}</span>}
  </a>;
}
