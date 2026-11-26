import type { AnswerInput, Vote } from '../../../../../shared/schema';
import { api } from '../../../api/client';

export interface InvitePoll {
  id: string;
  title: string;
  status: 'open' | 'confirmed';
  accepting: boolean;
  deadlineAt: string | null;
  group: { id: string; name: string; color: string | null };
  host: string | null;
  candidates: { id: string; date: string; startTime: string | null }[];
  confirmed: { date: string; startTime: string | null } | null;
  ownAnswer: { name: string; comment: string | null; votes: Record<string, Vote> } | null;
}

export type InviteResult = { status: 'ok'; poll: InvitePoll } | { status: 'invalid' } | { status: 'error' };

const inviteRequests = new Map<string, Promise<InviteResult>>();

/** 同時進行の同じ招待取得だけを1回に束ね、開発時のStrictMode二重実行でゲストCookieが競合しないようにする。 */
export function fetchInvite(token: string): Promise<InviteResult> {
  const existing = inviteRequests.get(token);
  if (existing) return existing;
  const request = api.api.invite.$post({ json: { token } }).then(async response => {
    if (response.status === 404) return { status: 'invalid' } as const;
    if (!response.ok) return { status: 'error' } as const;
    return { status: 'ok', poll: (await response.json()).poll as InvitePoll } as const;
  });
  inviteRequests.set(token, request);
  const clear = () => inviteRequests.delete(token);
  request.then(clear, clear);
  return request;
}

export type AnswerResult = 'ok' | 'closed' | 'invalid' | 'forbidden' | 'conflict' | 'rate_limited' | 'error';

export async function submitAnswer(
  token: string, name: string, comment: string, votes: AnswerInput['votes'],
): Promise<AnswerResult> {
  const response = await api.api.invite.answer.$post({ json: { token, name, comment, votes } });
  if (response.status === 410) return 'closed';
  if (response.status === 429) return 'rate_limited';
  if (response.status === 403) return 'forbidden';
  if (response.status === 404) return 'invalid';
  if (response.status === 409) return 'conflict';
  return response.ok ? 'ok' : 'error';
}

/** 回答完了からグループ作成へ進むクリックだけを記録する。遷移を待たせないためkeepaliveで送る。 */
export function recordUsageStartClick(token: string) {
  void fetch(`${window.location.origin}/api/invite/usage-start-click`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => undefined);
}
