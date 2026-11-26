import type { MemberPoll } from '../api/polls';
import { toJst } from '../../../lib/date';

export type EditableCandidate = { id?: string; date: string; time: string | null };

export const datetimeInput = (iso: string | null) => {
  if (!iso) return '';
  const jst = toJst(iso);
  return `${jst.date}T${jst.time}`;
};

export function editError(title: string, candidates: EditableCandidate[], reopen: boolean, deadline: string): string | undefined {
  if (!title.trim()) return '予定名を入力してください';
  if (!candidates.length || candidates.some(c => !c.date)) return '候補日を1つ以上入力してください';
  if (candidates.length > 31) return '候補日は31件までです';
  if (reopen && !deadline) return '再調整を始めるには新しい回答締切を設定してください';
  if (new Set(candidates.map(c => `${c.date}\0${c.time ?? ''}`)).size !== candidates.length) {
    return '同じ日時の候補が重複しています';
  }
  if (deadline && new Date(`${deadline}:00+09:00`).getTime() <= Date.now()) {
    return '回答締切は未来の日時にしてください';
  }
}

export const voteCount = (poll: MemberPoll, candidateId?: string) => candidateId
  ? poll.answers.reduce((count, answer) => count + (answer.votes[candidateId] ? 1 : 0), 0)
  : 0;

export function changedVotes(poll: MemberPoll, candidates: EditableCandidate[]) {
  const original = new Map(poll.candidates.map(c => [c.id, c]));
  let count = 0;
  for (const item of candidates) {
    if (!item.id) continue;
    const before = original.get(item.id);
    if (before && (before.date !== item.date || before.startTime !== item.time)) count += voteCount(poll, item.id);
  }
  // 削除された候補は削除操作の確認ダイアログで件数を示済みなので、保存時に二重確認しない
  return count;
}
