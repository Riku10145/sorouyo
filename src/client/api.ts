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
  confirmedEventId: string | null;
  editVersion: number;
  reopenPending: boolean;
  group: { id: string; name: string; color: string | null };
  creatorId: string;
  hostName: string | null;
  candidates: { id: string; date: string; startTime: string | null }[];
  answers: { id: string; name: string; comment: string | null; own: boolean; votes: Record<string, Vote>; createdAt: string }[];
}

export interface PollSummary {
  id: string;
  title: string;
  status: 'open' | 'confirmed';
  deadlineAt: string | null;
  accepting: boolean;
  group: { id: string; name: string; color: string | null };
  creator: boolean;
  candidatesCount: number;
  answersCount: number;
  confirmed: { date: string; startTime: string | null } | null;
}

export type InviteResult = { status: 'ok'; poll: InvitePoll } | { status: 'invalid' } | { status: 'error' };

export async function fetchInvite(token: string): Promise<InviteResult> {
  const response = await api.api.invite.$post({ json: { token } });
  if (response.status === 404) return { status: 'invalid' };
  if (!response.ok) return { status: 'error' };
  return { status: 'ok', poll: (await response.json()).poll as InvitePoll };
}

export type AnswerResult = 'ok' | 'closed' | 'invalid' | 'forbidden' | 'conflict' | 'error';

export async function submitAnswer(
  token: string, name: string, comment: string, votes: { candidateId: string; value: Vote }[],
): Promise<AnswerResult> {
  const response = await api.api.invite.answer.$post({ json: { token, name, comment, votes } });
  if (response.status === 410) return 'closed';
  if (response.status === 403) return 'forbidden';
  if (response.status === 404) return 'invalid';
  if (response.status === 409) return 'conflict';
  return response.ok ? 'ok' : 'error';
}

export async function fetchPolls(): Promise<{ status: number; polls?: PollSummary[] }> {
  const response = await api.api.polls.$get();
  if (!response.ok) return { status: response.status };
  return { status: 200, polls: (await response.json()).polls as PollSummary[] };
}

export async function createPoll(
  groupId: string,
  body: { title: string; deadlineAt?: string | null; candidates: { date: string; time?: string | null }[] },
): Promise<{ id: string; token: string } | null> {
  const response = await api.api.groups[':id'].polls.$post({ param: { id: groupId }, json: body });
  if (!response.ok) return null;
  const data = await response.json();
  return { id: data.poll.id, token: data.token };
}

export async function fetchMemberPoll(id: string): Promise<{ status: number; poll?: MemberPoll }> {
  const response = await api.api.polls[':id'].$get({ param: { id } });
  if (!response.ok) return { status: response.status };
  return { status: 200, poll: (await response.json()).poll as MemberPoll };
}

export async function confirmCandidate(id: string, candidateId: string): Promise<string | null> {
  const response = await api.api.polls[':id'].confirm.$post({ param: { id }, json: { candidateId } });
  if (!response.ok) return null;
  return (await response.json()).event?.id ?? null;
}

export async function issueInviteToken(id: string): Promise<string | null> {
  const response = await api.api.polls[':id'].invite.$post({ param: { id } });
  if (!response.ok) return null;
  return (await response.json()).token;
}

// --- グループ・予定・参加リンク（#24 #25 #26） ----------------------------------

export interface GroupInfo { id: string; name: string; color: string | null; role: 'admin' | 'member' }
export interface GroupDetail {
  group: GroupInfo;
  members: { id: string; name: string; role: 'admin' | 'member'; you: boolean }[];
  counts: { events: number; polls: number; members: number };
}
export interface CalEvent {
  id: string; date: string; startTime: string | null; title: string; memo: string | null;
  group: { id: string; name: string; color: string | null };
  sourcePollId: string | null;
}
export interface JoinPreview {
  group: { id: string; name: string; color: string | null };
  inviterName: string | null;
  memberCount: number;
  upcoming: { date: string; title: string }[];
  member: boolean;
}

export async function fetchGroups(): Promise<GroupInfo[] | null> {
  const response = await api.api.groups.$get();
  if (!response.ok) return null;
  return (await response.json()).groups as GroupInfo[];
}

export async function createGroup(name: string, color: string | null): Promise<GroupInfo | null> {
  const response = await api.api.groups.$post({ json: { name, color } });
  if (!response.ok) return null;
  return (await response.json()).group as GroupInfo;
}

export async function updateGroup(id: string, name: string, color: string | null): Promise<GroupInfo | null> {
  const response = await api.api.groups[':id'].$patch({ param: { id }, json: { name, color } });
  if (!response.ok) return null;
  return (await response.json()).group as GroupInfo;
}

export async function deleteGroup(id: string): Promise<boolean> {
  const response = await api.api.groups[':id'].$delete({ param: { id } });
  return response.status === 204;
}

export async function fetchGroup(id: string): Promise<{ status: number; detail?: GroupDetail }> {
  const response = await api.api.groups[':id'].$get({ param: { id } });
  if (!response.ok) return { status: response.status };
  return { status: 200, detail: await response.json() as GroupDetail };
}

export async function issueGroupInvite(id: string): Promise<string | null> {
  const response = await api.api.groups[':id'].invites.$post({ param: { id } });
  if (!response.ok) return null;
  return (await response.json()).token;
}

export async function previewJoin(token: string): Promise<JoinPreview | null> {
  const response = await api.api.groups.join.preview.$post({ json: { token } });
  if (!response.ok) return null;
  return await response.json() as JoinPreview;
}

export type JoinResult = { status: 'joined'; already: boolean; group: GroupInfo } | { status: 'invalid' } | { status: 'login' } | { status: 'error' };
export async function joinGroup(token: string): Promise<JoinResult> {
  const response = await api.api.groups.join.$post({ json: { token } });
  if (response.status === 404) return { status: 'invalid' };
  if (response.status === 401) return { status: 'login' };
  if (!response.ok) return { status: 'error' };
  const data = await response.json();
  return { status: 'joined', already: data.already, group: data.group as GroupInfo };
}

export async function fetchCalendar(month: string): Promise<CalEvent[] | null> {
  const response = await api.api.calendar.$get({ query: { month } });
  if (!response.ok) return null;
  return (await response.json()).events as CalEvent[];
}

export async function createEvent(groupId: string, body: { date: string; title: string; time?: string | null }): Promise<{ id: string } | null> {
  const response = await api.api.groups[':id'].events.$post({ param: { id: groupId }, json: { date: body.date, title: body.title, time: body.time ?? null } });
  if (!response.ok) return null;
  return (await response.json()).event;
}

export async function fetchEvent(id: string): Promise<{ status: number; event?: CalEvent }> {
  const response = await api.api.events[':id'].$get({ param: { id } });
  if (!response.ok) return { status: response.status };
  return { status: 200, event: (await response.json()).event as CalEvent };
}

export async function updateEvent(
  id: string,
  body: { date: string; title: string; time?: string | null; memo?: string | null },
): Promise<boolean> {
  const response = await api.api.events[':id'].$patch({ param: { id }, json: body });
  return response.ok;
}

export async function deleteEvent(id: string): Promise<boolean> {
  const response = await api.api.events[':id'].$delete({ param: { id } });
  return response.ok;
}

export async function updatePoll(
  id: string,
  body: { editVersion: number; title: string; deadlineAt?: string | null; candidates: { id?: string; date: string; time?: string | null }[] },
): Promise<number> {
  const response = await api.api.polls[':id'].$patch({ param: { id }, json: body });
  return response.status;
}

export async function deletePoll(id: string): Promise<boolean> {
  const response = await api.api.polls[':id'].$delete({ param: { id } });
  return response.ok;
}

export async function unconfirmPoll(id: string, eventId: string): Promise<boolean> {
  const response = await api.api.polls[':id'].unconfirm.$post({ param: { id }, json: { eventId } });
  return response.ok;
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
