import { icons, type IconName } from '../design/art';

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  const Svg = icons[name];
  return <Svg width={size} height={size} className={className} />;
}
