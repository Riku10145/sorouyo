import { shortDate } from '../../../lib/date';
import type { PollSummary } from '../api/polls';

export const statusOf = (poll: PollSummary) =>
  poll.status === 'confirmed'
    ? { cls: 'confirmed', label: poll.confirmed ? `${shortDate(poll.confirmed.date)}に確定` : '確定' }
    : poll.accepting ? { cls: 'open', label: '受付中' } : { cls: 'expired', label: '締切済み' };
