import { z } from 'zod';

export const voteSchema = z.enum(['yes', 'maybe', 'no']);
export type Vote = z.infer<typeof voteSchema>;
export const VOTES = [
  { value: 'yes', mark: '○', label: '行ける' },
  { value: 'maybe', mark: '△', label: '未定' },
  { value: 'no', mark: '×', label: '行けない' },
] as const satisfies readonly { value: Vote; mark: string; label: string }[];
export const DAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

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
    const vote = voteSchema.safeParse(answer.votes[index]);
    if (vote.success) result[vote.data]++;
  }
  return result;
}
