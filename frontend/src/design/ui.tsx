import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Envelope, icons, stamps, type IconName } from './art';
import { VOTES } from '../lib/model';
import type { Vote } from '../../../shared/schema';
import { groupName, type CalendarEvent, type GroupId, type Poll } from '../lib/sample';

// グループの色。作成・編集画面はこのパレットから選び、DBには先頭の16進色を保存する
export const GROUP_COLORS = [
  { value: '#D97A3D', soft: '#F9E8D9' },
  { value: '#C95D7C', soft: '#F7E2E9' },
  { value: '#4E8A5A', soft: '#E3EFE4' },
  { value: '#7A5CA8', soft: '#EBE4F5' },
  { value: '#4A6E9E', soft: '#E2EAF3' },
  { value: '#B98A2E', soft: '#F3EAD3' },
] as const;
export const DEFAULT_GROUP_COLOR: string = GROUP_COLORS[0].value;
export const softOf = (color: string): string => GROUP_COLORS.find(item => item.value === color)?.soft ?? `${color}26`;

/** グループ表示: color があれば16進色のCSS変数、なければサンプルの g-* クラスを使う */
export type DisplayGroup = { id: string; name: string; color?: string | null; className?: GroupId };
export const groupVars = (group: { color?: string | null }): CSSProperties | undefined =>
  group.color ? ({ '--g': group.color, '--g-soft': softOf(group.color) } as CSSProperties) : undefined;
export const groupCls = (group: DisplayGroup): string => group.color ? '' : `g-${group.className ?? 'friends'}`;
export const Dot = ({ group }: { group: DisplayGroup }) =>
  <span className={`dot ${groupCls(group)}`} style={groupVars(group)} aria-hidden="true" />;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  const Svg = icons[name];
  return <Svg width={size} height={size} className={className} />;
}

export function Brand({ size = 36, sub }: { size?: number; sub?: string }) {
  return <a className="brand" href="/" aria-label="そろうよ ホーム">
    <span className="brand-mark" style={{ width: size, height: size }}><Icon name="brand" size={Math.round(size * 0.6)} /></span>
    <span className="brand-name">そろうよ</span>
    {sub && <span className="brand-sub">{sub}</span>}
  </a>;
}

export const GroupDot = ({ group }: { group: GroupId }) => <span className={`dot g-${group}`} aria-hidden="true" />;

export function EventPill({ event, long = false }: { event: CalendarEvent; long?: boolean }) {
  const label = long ? `${event.time ? event.time + ' ' : ''}${event.title}` : event.short ?? event.title;
  return <span className={`pill g-${event.group}`} title={`${groupName(event.group)}：${event.title}`}>{label}</span>;
}

export function StampArt({ event }: { event: CalendarEvent }) {
  if (!event.stamp) return null;
  const Svg = stamps[event.stamp];
  return <Svg className="stamp" width={44} height={40} />;
}

const MARK_ICON: Record<Vote, IconName> = { yes: 'yes', maybe: 'maybe', no: 'no' };
const voteText = (vote: Vote) => VOTES.find(item => item.value === vote)!;
export const VOTE_WORD: Record<Vote, string> = { yes: '参加', maybe: '未定', no: '欠席' };

export function VoteMark({ vote, withLabel = false }: { vote: Vote | null; withLabel?: boolean }) {
  return <span className={`vote-mark v-${vote ?? 'none'}`}>
    <Icon name={vote ? MARK_ICON[vote] : 'pending'} size={16} />
    {withLabel ? <span>{vote ? VOTE_WORD[vote] : '未回答'}</span> : <span className="sr-only">{vote ? `${voteText(vote).mark} ${VOTE_WORD[vote]}` : '未回答'}</span>}
  </span>;
}

const ARROW_STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function VotePicker({ value, onChange, label, describedBy }: { value: Vote | null; onChange: (vote: Vote) => void; label: string; describedBy?: string }) {
  const current = Math.max(0, VOTES.findIndex(vote => vote.value === value));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = ARROW_STEP[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (current + step + VOTES.length) % VOTES.length;
    onChange(VOTES[next]!.value);
    (event.currentTarget.children[next] as HTMLElement | undefined)?.focus();
  };
  return <div className="vote-picker" role="radiogroup" aria-label={label} aria-required="true" aria-invalid={describedBy && value === null ? true : undefined} aria-describedby={value === null ? describedBy : undefined} onKeyDown={onKeyDown}>
    {VOTES.map((vote, i) => <button type="button" key={vote.value} role="radio" aria-checked={value === vote.value} tabIndex={i === current ? 0 : -1}
      aria-label={`${vote.mark} ${VOTE_WORD[vote.value]}`} className={`vote-btn v-${vote.value}`} onClick={() => onChange(vote.value)}>
      <Icon name={MARK_ICON[vote.value]} size={24} />
    </button>)}
  </div>;
}

export function InviteHero({ poll, eyebrow, children, footer, compact = false }: { poll: Poll; eyebrow?: string; children?: ReactNode; footer?: ReactNode; compact?: boolean }) {
  return <section className={`invite-hero${compact ? ' compact' : ''}`} aria-label={`${poll.title}の招待`}>
    <div className="invite-copy">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className="invite-title">{poll.title}</h1>
      {children}
    </div>
    <Envelope className="envelope" width={128} height={92} />
    {footer}
  </section>;
}

let showToast: (message: string) => void = () => {};
export const notReady = (what: string) => showToast(`${what}は次の更新で使えるようになります`);
export const toast = (message: string) => showToast(message);

export function Toaster() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    showToast = next => { setMessage(next); clearTimeout(timer); timer = setTimeout(() => setMessage(''), 3200); };
    return () => clearTimeout(timer);
  }, []);
  return <div role="status" aria-live="polite">{message && <div className="toast">{message}</div>}</div>;
}
