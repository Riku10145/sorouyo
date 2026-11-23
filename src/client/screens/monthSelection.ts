import { shiftedMonth } from '../../shared/model';

export function monthSelection(month: string, direction: number, today: string): string {
  const next = shiftedMonth(month, direction);
  return next === today.slice(0, 7) ? today : `${next}-01`;
}
