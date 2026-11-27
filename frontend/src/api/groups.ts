import { api } from './client';

export interface GroupInfo { id: string; name: string; color: string | null; role: 'admin' | 'member' }

export async function fetchGroups(): Promise<GroupInfo[] | null> {
  const response = await api.api.groups.$get();
  if (!response.ok) return null;
  return (await response.json()).groups as GroupInfo[];
}

export async function createGroup(name: string, color: string | null): Promise<{ status: number; group?: GroupInfo }> {
  const response = await api.api.groups.$post({ json: { name, color } });
  if (!response.ok) return { status: response.status };
  return { status: response.status, group: (await response.json()).group as GroupInfo };
}
