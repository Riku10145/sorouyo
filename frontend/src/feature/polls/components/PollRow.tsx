import { Dot } from '../../../components/Dot';
import { Icon } from '../../../components/Icon';
import { shortDate, toJst } from '../../../lib/date';
import type { PollSummary } from '../api/polls';
import { statusOf } from '../lib/pollStatus';

export function PollRow({ poll }: { poll: PollSummary }) {
  const status = statusOf(poll);
  const deadline = poll.deadlineAt ? toJst(poll.deadlineAt) : null;
  return <a className="poll-row card" href={`/polls/${poll.id}`}>
    <span className="poll-row-main">
      <strong>{poll.title}</strong>
      <span className="poll-meta">
        <Dot group={poll.group} />{poll.group.name}
        <span aria-hidden="true">・</span>候補{poll.candidatesCount}日
        <span aria-hidden="true">・</span>回答{poll.answersCount}人
        {deadline && <><span aria-hidden="true">・</span>締切 {shortDate(deadline.date)} {deadline.time}</>}
      </span>
    </span>
    <span className={`poll-status ${status.cls}`}>{status.label}{poll.creator && '・主催'}</span>
    <Icon name="chevronRight" size={18} />
  </a>;
}
