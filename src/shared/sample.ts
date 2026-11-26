import type { PollAnswer } from './model';

// Paper「そろうよ モバイルデザイン」の代表画面と同じサンプルデータ。画面比較はこのデータで行う。
export const SAMPLE_MONTH = '2026-11';
export const SAMPLE_SELECTED_DATE = '2026-11-21';

export type GroupId = 'family' | 'pair' | 'friends' | 'games';
export const GROUPS = [
  { id: 'family', name: '家族' },
  { id: 'pair', name: 'ふたり' },
  { id: 'friends', name: 'いつメン' },
  { id: 'games', name: 'ゲーム部' },
] as const satisfies readonly { id: GroupId; name: string }[];
export const groupName = (id: GroupId): string => GROUPS.find(group => group.id === id)!.name;

export type Stamp = 'sun' | 'flower' | 'leaves' | 'star';
export type CalendarEvent = { date: string; title: string; short?: string; time?: string; group: GroupId; stamp?: Stamp };

export const SAMPLE_EVENTS: readonly CalendarEvent[] = [
  { date: '2026-11-04', title: '朝ヨガ', group: 'pair' },
  { date: '2026-11-06', title: '映画', group: 'pair' },
  { date: '2026-11-08', title: '帰省', group: 'family' },
  { date: '2026-11-10', title: '読書会', group: 'friends' },
  { date: '2026-11-11', title: '朝ヨガ', group: 'pair' },
  { date: '2026-11-12', title: 'ボードゲーム', short: 'ボドゲ', group: 'games' },
  { date: '2026-11-14', title: 'ゲーム', group: 'games' },
  { date: '2026-11-15', title: '朝カフェ', short: 'カフェ', group: 'friends' },
  { date: '2026-11-18', title: '朝ヨガ', group: 'pair' },
  { date: '2026-11-19', title: '餃子会', group: 'friends' },
  { date: '2026-11-21', time: '11:00', title: 'おうちランチ', short: 'ランチ', group: 'family', stamp: 'sun' },
  { date: '2026-11-21', time: '17:30', title: '映画デート', short: '映画', group: 'pair', stamp: 'flower' },
  { date: '2026-11-24', title: 'オンラインゲーム', short: 'ゲーム', group: 'games' },
  { date: '2026-11-25', title: '朝ヨガ', group: 'pair' },
  { date: '2026-11-28', title: 'ゲーム', group: 'games' },
  { date: '2026-12-02', title: '朝ヨガ', group: 'pair' },
];

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
