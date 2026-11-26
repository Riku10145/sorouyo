import type { MemberPoll } from '../api/polls';
import type { InvitePoll } from '../api/invite';
import { dateLabel, toJst } from '../../../lib/date';
import type { GroupId } from '../../../lib/groups';
import type { PollAnswer } from './votes';

export type PollGroup = { name: string; className?: GroupId; color?: string };

export type Candidate = { id?: string; date: string; time: string };

export type Poll = {
  /** 実データの日程調整ID。完了画面など表示中の状態をどの調整に紐づけるかに使う */
  id?: string;
  token: string;
  title: string;
  group: PollGroup;
  host: string;
  deadline: { date: string; time: string } | null;
  closed: boolean;
  candidates: readonly Candidate[];
  answers: readonly PollAnswer[];
  /** 確定した候補のインデックス（実データのみ。サンプルは closed だけを使う） */
  confirmedIndex?: number | null;
  /** 確定時に作られた予定ID。古い画面からの取消が再確定済みの予定を消さないように使う */
  confirmedEventId?: string | null;
};

export const deadlineText = (poll: Poll) => poll.deadline ? `${dateLabel(poll.deadline.date)}${poll.deadline.time}` : 'なし';

export const guestUrl = (poll: Poll) => `${window.location.origin}/r#${poll.token}`;

export function memberPollView(remote: MemberPoll): Poll {
  const confirmedIndex = remote.confirmedCandidateId
    ? remote.candidates.findIndex(c => c.id === remote.confirmedCandidateId) : null;
  return {
    id: remote.id,
    token: '',
    title: remote.title,
    group: { name: remote.group.name, color: remote.group.color ?? undefined },
    host: remote.hostName ?? '幹事',
    deadline: remote.deadlineAt ? toJst(remote.deadlineAt) : null,
    closed: remote.status === 'confirmed',
    candidates: remote.candidates.map(c => ({ id: c.id, date: c.date, time: c.startTime ?? '' })),
    answers: remote.answers.map(a => ({
      id: a.id,
      name: a.name,
      comment: a.comment ?? undefined,
      own: a.own,
      votes: remote.candidates.map(c => a.votes[c.id] ?? null),
    })),
    confirmedIndex: confirmedIndex !== null && confirmedIndex >= 0 ? confirmedIndex : null,
    confirmedEventId: remote.confirmedEventId,
  };
}

export function invitePollView(result: InvitePoll, token: string): Poll {
  return {
    token,
    title: result.title,
    group: { name: result.group.name, color: result.group.color ?? undefined },
    host: result.host ?? '幹事',
    deadline: result.deadlineAt ? toJst(result.deadlineAt) : null,
    closed: !result.accepting,
    candidates: result.candidates.map(c => ({ id: c.id, date: c.date, time: c.startTime ?? '' })),
    answers: [],
  };
}
