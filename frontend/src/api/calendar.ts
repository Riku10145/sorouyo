import { api } from './client';

export interface CalEvent {
  id: string; date: string; startTime: string | null; title: string; memo: string | null;
  group: { id: string; name: string; color: string | null };
  sourcePollId: string | null;
}

export async function fetchCalendar(month: string): Promise<CalEvent[] | null> {
  const response = await api.api.calendar.$get({ query: { month } });
  if (!response.ok) return null;
  return (await response.json()).events as CalEvent[];
}
