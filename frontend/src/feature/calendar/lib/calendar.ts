import type { CalEvent } from '../../../api/calendar';
import type { DisplayGroup } from '../../../lib/groups';
import { type Stamp, groupName, type CalendarEvent } from './sample';

export interface ViewEvent {
  id?: string; date: string; title: string; short?: string;
  time?: string | null; stamp?: Stamp; group: DisplayGroup;
}

export type MonthLoad = { status: 'loading' } | { status: 'error' } | { status: 'loaded'; events: ViewEvent[] };

export const sampleView = (events: readonly CalendarEvent[]): ViewEvent[] =>
  events.map(event => ({
    ...event,
    group: { id: event.group, name: groupName(event.group), className: event.group },
  }));

export const toView = (event: CalEvent): ViewEvent => ({
  id: event.id, date: event.date, title: event.title, time: event.startTime,
  group: { id: event.group.id, name: event.group.name, color: event.group.color },
});
