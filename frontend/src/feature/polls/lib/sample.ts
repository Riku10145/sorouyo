import type { Poll } from './poll';

const gyoza = {
  title: '餃子の会',
  group: { name: 'いつメン', className: 'friends' },
  host: 'たろう',
  deadline: { date: '2026-11-21', time: '21:00' },
  candidates: [
    { date: '2026-11-22', time: '12:00' },
    { date: '2026-11-26', time: '19:00' },
    { date: '2026-11-28', time: '19:00' },
  ],
  answers: [
    { name: 'たろう', votes: [null, null, null] },
    { name: 'はな', votes: ['yes', 'yes', 'no'], comment: '19時以降なら参加できます' },
    { name: 'けんじ', votes: ['no', 'maybe', 'yes'] },
    { name: 'ゆい', votes: ['maybe', 'yes', 'no'] },
  ],
} as const satisfies Omit<Poll, 'token' | 'closed'>;

export const SAMPLE_POLLS: readonly Poll[] = [
  { ...gyoza, token: 'sample', closed: false },
  { ...gyoza, token: 'sample-closed', closed: true },
];

export const SAMPLE_ORGANIZER = 'たろう';

export const findPoll = (token: string): Poll | undefined => SAMPLE_POLLS.find(poll => poll.token === token);
