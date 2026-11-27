import { api } from '../../api/client';
import type { GroupInfo } from '../../api/groups';

export interface JoinInviteInfo {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  state: 'active' | 'expired' | 'revoked';
}

export interface GroupDetail {
  group: GroupInfo;
  creatorId: string | null;
  members: { id: string; name: string; role: 'admin' | 'member'; you: boolean }[];
  counts: { events: number; polls: number; members: number };
  joinInvite: JoinInviteInfo | null;
}

export interface JoinPreview {
  group: { id: string; name: string; color: string | null };
  inviterName: string | null;
  memberCount: number;
  upcoming: { date: string; title: string }[];
  member: boolean;
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

export async function removeGroupMember(groupId: string, userId: string): Promise<boolean> {
  const response = await api.api.groups[':id'].members[':userId'].$delete({ param: { id: groupId, userId } });
  return response.status === 204;
}

export async function fetchGroup(id: string): Promise<{ status: number; detail?: GroupDetail }> {
  const response = await api.api.groups[':id'].$get({ param: { id } });
  if (!response.ok) return { status: response.status };
  return { status: 200, detail: await response.json() as GroupDetail };
}

export async function issueGroupInvite(id: string): Promise<{ token: string; invite: JoinInviteInfo } | null> {
  const response = await api.api.groups[':id'].invites.$post({ param: { id } });
  if (!response.ok) return null;
  return await response.json() as { token: string; invite: JoinInviteInfo };
}

export async function revokeGroupInvite(groupId: string, inviteId: string): Promise<JoinInviteInfo | null> {
  const response = await api.api.groups[':id'].invites[':inviteId'].revoke.$post({ param: { id: groupId, inviteId } });
  if (!response.ok) return null;
  return (await response.json()).invite as JoinInviteInfo;
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
