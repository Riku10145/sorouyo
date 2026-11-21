import { useEffect, useState, type ReactNode } from 'react';
import { Envelope, icons, stamps, type IconName } from './art';
import { VOTES, type Vote } from '../../shared/model';
import { groupName, type CalendarEvent, type GroupId, type Poll } from '../../shared/sample';

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

export function VotePicker({ value, onChange, label }: { value: Vote | null; onChange: (vote: Vote) => void; label: string }) {
  return <div className="vote-picker" role="radiogroup" aria-label={label}>
    {VOTES.map(vote => <button type="button" key={vote.value} role="radio" aria-checked={value === vote.value}
      aria-label={`${vote.mark} ${VOTE_WORD[vote.value]}`} className={`vote-btn v-${vote.value}`} onClick={() => onChange(vote.value)}>
      <Icon name={MARK_ICON[vote.value]} size={24} />
    </button>)}
  </div>;
}

export function InviteHero({ poll, eyebrow, children, compact = false }: { poll: Poll; eyebrow?: string; children?: ReactNode; compact?: boolean }) {
  return <section className={`invite-hero${compact ? ' compact' : ''}`} aria-label={`${poll.title}の招待`}>
    <div className="invite-copy">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className="invite-title">{poll.title}</h1>
      {children}
    </div>
    <Envelope className="envelope" width={128} height={92} />
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
  return <div className="toast" role="status" aria-live="polite" hidden={!message}>{message}</div>;
}
