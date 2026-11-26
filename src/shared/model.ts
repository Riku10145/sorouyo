export const VOTE_VALUES = ['yes', 'maybe', 'no'] as const;
export type Vote = (typeof VOTE_VALUES)[number];
const isVote = (value: unknown): value is Vote => VOTE_VALUES.some(vote => vote === value);
export const VOTES = [
  { value: 'yes', mark: '○', label: '行ける' },
  { value: 'maybe', mark: '△', label: '未定' },
  { value: 'no', mark: '×', label: '行けない' },
] as const satisfies readonly { value: Vote; mark: string; label: string }[];
export const DAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;
export const GROUP_CREATION_LIMIT = 5;

const padded = (number: number) => String(number).padStart(2, '0');
export const dateKey = (date: Date): string => `${date.getFullYear()}-${padded(date.getMonth() + 1)}-${padded(date.getDate())}`;
export const dateFromKey = (key: string): Date => {
  const [year = NaN, month = NaN, day = NaN] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};
export const validDate = (key: unknown): key is string => typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && dateKey(dateFromKey(key)) === key;
export function dateLabel(key: string, { year = false }: { year?: boolean } = {}): string {
  const date = dateFromKey(key);
  return `${year ? date.getFullYear() + '年' : ''}${date.getMonth() + 1}月${date.getDate()}日（${DAYS[date.getDay()]}）`;
}

export function monthCells(month: string): string[] {
  const [year = NaN, m = NaN] = month.split('-').map(Number);
  const first = new Date(year, m - 1, 1).getDay();
  const days = new Date(year, m, 0).getDate();
  return Array.from({ length: Math.ceil((first + days) / 7) * 7 }, (_, i) =>
    dateKey(new Date(year, m - 1, 1 + i - first))
  );
}

export function shiftedMonth(month: string, direction: number): string {
  const [year = NaN, number = NaN] = month.split('-').map(Number);
  return dateKey(new Date(year, number - 1 + direction, 1)).slice(0, 7);
}

export function tally(poll: { answers: readonly { votes: readonly unknown[] }[] }, index: number): Record<Vote, number> {
  const result = { yes: 0, maybe: 0, no: 0 };
  for (const answer of poll.answers) {
    const vote = answer.votes[index];
    if (isVote(vote)) result[vote]++;
  }
  return result;
}

export type PollAnswer = { name: string; votes: readonly (Vote | null)[]; comment?: string; own?: boolean; id?: string };

export const answered = (answer: PollAnswer): boolean => answer.votes.some(vote => vote !== null);

export function bestCandidate(poll: { candidates: readonly unknown[]; answers: readonly PollAnswer[] }): number {
  const score = (index: number) => {
    const { yes, maybe, no } = tally(poll, index);
    return [yes, maybe, -no] as const;
  };
  return poll.candidates.reduce<number>((best, _, index) => {
    const [a, b] = [score(index), score(best)];
    const diff = a.findIndex((value, i) => value !== b[i]);
    return diff >= 0 && a[diff]! > b[diff]! ? index : best;
  }, 0);
}

export const shortDate = (key: string): string => `${Number(key.slice(5, 7))}/${Number(key.slice(8))}`;
/** 開始時刻の表示。空なら終日 */
export const timeLabel = (time: string): string => time ? `${time}〜` : '終日';
export const weekday = (key: string): string => DAYS[dateFromKey(key).getDay()]!;
export const dayTone = (key: string): 'sun' | 'sat' | undefined => {
  const day = dateFromKey(key).getDay();
  return day === 0 ? 'sun' : day === 6 ? 'sat' : undefined;
};

export function answerError(votes: readonly (Vote | null)[], name: string): string {
  if (votes.some(vote => vote === null)) return 'すべての候補日に○△×を選んでください。';
  if (!name.trim()) return 'お名前を入力してください。';
  return '';
}
