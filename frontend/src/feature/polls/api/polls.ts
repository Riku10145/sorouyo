import type { CreatePollInput, UpdatePollInput, Vote } from '../../../../../shared/schema';
import { api } from '../../../api/client';

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
  /** 作成者にだけ返る。催促対象の分類（#7）に使う */
  members?: { id: string; name: string; answered: boolean }[];
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

export async function fetchPolls(): Promise<{ status: number; polls?: PollSummary[] }> {
  const response = await api.api.polls.$get();
  if (!response.ok) return { status: response.status };
  return { status: 200, polls: (await response.json()).polls as PollSummary[] };
}

export async function createPoll(
  groupId: string,
  body: CreatePollInput,
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

export async function updatePoll(
  id: string,
  body: UpdatePollInput,
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
