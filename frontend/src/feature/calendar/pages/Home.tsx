import { useMe } from '../../../hooks/useMe';
import type { DisplayGroup } from '../../../lib/groups';
import { CalendarView } from '../components/CalendarView';
import { MemberCalendar } from '../components/MemberCalendar';
import { sampleView } from '../lib/calendar';
import { GROUPS, SAMPLE_EVENTS } from '../lib/sample';

export function Home({ today, initialDate }: { today: string; initialDate: string }) {
  const me = useMe();
  if (me === undefined) {
    return <div className="app-shell"><main className="app-main"><p className="loading-note">読み込み中…</p></main></div>;
  }
  if (me === null) {
    // ログイン前はサンプルデータで雰囲気を伝える
    const sampleGroups: DisplayGroup[] = GROUPS.map(g => ({ id: g.id, name: g.name, className: g.id }));
    return <CalendarView today={today} initialDate={initialDate} groups={sampleGroups} events={sampleView(SAMPLE_EVENTS)} />;
  }
  return <MemberCalendar today={today} initialDate={initialDate} />;
}
