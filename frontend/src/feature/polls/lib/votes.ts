import type { Vote } from '../../../../../shared/schema';

export const VOTES = [
  { value: 'yes', mark: '○', label: '参加' },
  { value: 'maybe', mark: '△', label: '未定' },
  { value: 'no', mark: '×', label: '欠席' },
] as const satisfies readonly { value: Vote; mark: string; label: string }[];

const isVote = (value: unknown): value is Vote => VOTES.some(vote => vote.value === value);

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

export function answerError(votes: readonly (Vote | null)[], name: string): string {
  if (votes.some(vote => vote === null)) return 'すべての候補日に○△×を選んでください。';
  if (!name.trim()) return 'お名前を入力してください。';
  return '';
}
