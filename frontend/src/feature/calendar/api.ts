import type { EventInput } from '../../../../shared/schema';
import type { CalEvent } from '../../api/calendar';
import { api } from '../../api/client';

export async function createEvent(groupId: string, body: Omit<EventInput, 'memo'>): Promise<{ id: string } | 'limit' | null> {
  const response = await api.api.groups[':id'].events.$post({ param: { id: groupId }, json: { date: body.date, title: body.title, time: body.time ?? null } });
  if (response.status === 409) return 'limit';
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
  body: EventInput,
): Promise<boolean> {
  const response = await api.api.events[':id'].$patch({ param: { id }, json: body });
  return response.ok;
}

export async function deleteEvent(id: string): Promise<boolean> {
  const response = await api.api.events[':id'].$delete({ param: { id } });
  return response.ok;
}
