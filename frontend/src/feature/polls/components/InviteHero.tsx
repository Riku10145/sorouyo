import type { ReactNode } from 'react';
import { Envelope } from '../../../design/art';
import type { Poll } from '../lib/poll';

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
