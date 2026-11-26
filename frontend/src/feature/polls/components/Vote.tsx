import type { KeyboardEvent } from 'react';
import type { Vote } from '../../../../../shared/schema';
import { Icon } from '../../../components/Icon';
import { VOTES } from '../lib/votes';

export function VoteMark({ vote, withLabel = false }: { vote: Vote | null; withLabel?: boolean }) {
  const option = VOTES.find(item => item.value === vote);
  return <span className={`vote-mark v-${vote ?? 'none'}`}>
    <Icon name={vote ?? 'pending'} size={16} />
    {withLabel ? <span>{option?.label ?? '未回答'}</span> : <span className="sr-only">{option ? `${option.mark} ${option.label}` : '未回答'}</span>}
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
      aria-label={`${vote.mark} ${vote.label}`} className={`vote-btn v-${vote.value}`} onClick={() => onChange(vote.value)}>
      <Icon name={vote.value} size={24} />
    </button>)}
  </div>;
}
