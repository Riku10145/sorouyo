import { useEffect, useState } from 'react';
import { hc } from 'hono/client';
import type { AppType } from '../worker';
import type { Vote } from '../shared/model';

export const api = hc<AppType>(window.location.origin);

// --- #3 共有データAPI ---------------------------------------------------------

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

export interface MemberPoll {
  id: string;
  title: string;
  status: 'open' | 'confirmed';
  deadlineAt: string | null;
  confirmedCandidateId: string | null;
  group: { id: string; name: string; color: string | null };
  creatorId: string;
  hostName: string | null;
  candidates: { id: string; date: string; startTime: string | null }[];
  answers: { id: string; name: string; comment: string | null; own: boolean; votes: Record<string, Vote>; createdAt: string }[];
}

export type InviteResult = { status: 'ok'; poll: InvitePoll } | { status: 'invalid' };

export async function fetchInvite(token: string): Promise<InviteResult> {
  const response = await api.api.invite.$post({ json: { token } });
  if (response.status === 404) return { status: 'invalid' };
  if (!response.ok) return { status: 'invalid' };
  return { status: 'ok', poll: (await response.json()).poll as InvitePoll };
}

export type AnswerResult = 'ok' | 'closed' | 'invalid' | 'error';

export async function submitAnswer(
  token: string, name: string, comment: string, votes: { candidateId: string; value: Vote }[],
): Promise<AnswerResult> {
  const response = await api.api.invite.answer.$post({ json: { token, name, comment, votes } });
  if (response.status === 410) return 'closed';
  if (response.status === 404 || response.status === 403) return 'invalid';
  return response.ok ? 'ok' : 'error';
}

export async function fetchMemberPoll(id: string): Promise<{ status: number; poll?: MemberPoll }> {
  const response = await api.api.polls[':id'].$get({ param: { id } });
  if (!response.ok) return { status: response.status };
  return { status: 200, poll: (await response.json()).poll as MemberPoll };
}

export async function confirmCandidate(id: string, candidateId: string): Promise<boolean> {
  const response = await api.api.polls[':id'].confirm.$post({ param: { id }, json: { candidateId } });
  return response.ok;
}

export async function issueInviteToken(id: string): Promise<string | null> {
  const response = await api.api.polls[':id'].invite.$post({ param: { id } });
  if (!response.ok) return null;
  return (await response.json()).token;
}

/** UTCのISOを画面表示用の日本時間に変換する。 */
export const toJst = (iso: string): { date: string; time: string } => ({
  date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)),
  time: new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)),
});

export type Me = { user: { id: string; email: string; firstName: string | null; lastName: string | null } };

export function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    api.api.auth.me.$get().then(async response => {
      if (!active) return;
      setMe(response.ok ? await response.json() as Me : null);
    }).catch(() => { if (active) setMe(null); });
    return () => { active = false; };
  }, []);
  return me;
}
