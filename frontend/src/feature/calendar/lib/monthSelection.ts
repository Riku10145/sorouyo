import { shiftedMonth } from '../../../lib/date';

export function monthSelection(month: string, direction: number, today: string): string {
  const next = shiftedMonth(month, direction);
  return next === today.slice(0, 7) ? today : `${next}-01`;
}
