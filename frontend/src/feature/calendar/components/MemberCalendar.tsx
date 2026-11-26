import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchCalendar } from '../../../api/calendar';
import { createGroup, fetchGroups, type GroupInfo } from '../../../api/groups';
import { AppShell } from '../../../components/AppShell';
import { GroupForm } from '../../../components/GroupForm';
import { toast } from '../../../components/Toaster';
import { shiftedMonth } from '../../../lib/date';
import type { DisplayGroup } from '../../../lib/groups';
import { type MonthLoad, toView } from '../lib/calendar';
import { AddEventSheet } from './AddEventSheet';
import { CalendarView } from './CalendarView';

export function MemberCalendar({ today, initialDate }: { today: string; initialDate: string }) {
  const [groups, setGroups] = useState<GroupInfo[] | 'error' | null>(null);
  const [months, setMonths] = useState<Map<string, MonthLoad>>(new Map());
  const [addDate, setAddDate] = useState<string | null>(null);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const cache = useRef<Map<string, MonthLoad>>(new Map());

  useLayoutEffect(() => {
    if (addDate !== null) return;
    addTrigger.current?.focus();
    addTrigger.current = null;
  }, [addDate]);

  const loadMonth = async (month: string, refresh = false) => {
    if (!refresh && cache.current.has(month)) return;
    const request = { status: 'loading' } as const;
    cache.current.set(month, request);
    setMonths(new Map(cache.current));
    const events = await fetchCalendar(month).catch(() => null);
    if (cache.current.get(month) !== request) return;
    cache.current.set(month, events === null ? { status: 'error' } : { status: 'loaded', events: events.map(toView) });
    setMonths(new Map(cache.current));
  };

  useEffect(() => {
    void (async () => {
      const current = initialDate.slice(0, 7);
      const [list] = await Promise.all([fetchGroups(), loadMonth(current)]);
      // 月表示には隣月の日付も含まれる。初回表示を待たせないため前後月はバックグラウンドで取る
      void loadMonth(shiftedMonth(current, -1));
      void loadMonth(shiftedMonth(current, 1));
      // 取得失敗を「0件」と誤表示しない（グループがある人に空の案内を出さない）
      setGroups(list ?? 'error');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (groups === null) {
    return <div className="app-shell"><main className="app-main"><p className="loading-note">読み込み中…</p></main></div>;
  }
  if (groups === 'error') {
    return <div className="app-shell"><main className="app-main"><p className="loading-note">読み込めませんでした。時間をおいて再度お試しください。</p></main></div>;
  }

  if (groups.length === 0) {
    return <AppShell active="calendar" selectedDate={initialDate} groups={[]}>
      <section className="empty-hero">
        <h1>そろうよへようこそ</h1>
        <p>まずはグループを作りましょう。家族・仲間ごとに色を決めると、カレンダーで見分けられます。</p>
        <GroupForm submitLabel="グループを作成" showFreeNotice onSubmit={async (name, color) => {
          const created = await createGroup(name, color);
          if (!created.group) return '作成できませんでした';
          setGroups([created.group]);
          toast('グループを作成しました');
          return null;
        }} />
        <p className="hint"><a href="/groups">あとでグループページから作ることもできます</a></p>
      </section>
    </AppShell>;
  }

  const displayGroups: DisplayGroup[] = groups.map(g => ({ id: g.id, name: g.name, color: g.color }));

  return <>
    <CalendarView
      today={today} initialDate={initialDate}
      groups={displayGroups}
      events={[...months.values()].flatMap(load => load.status === 'loaded' ? load.events : [])}
      monthStatus={month => months.get(month)?.status ?? 'loading'}
      onRetry={month => void loadMonth(month, true)}
      onMonthChange={month => {
        void loadMonth(shiftedMonth(month, -1));
        void loadMonth(month);
        void loadMonth(shiftedMonth(month, 1));
      }}
      onAdd={(date, trigger) => {
        addTrigger.current = trigger;
        setAddDate(date);
      }}
      dayLink={event => event.id ? `/events/${event.id}` : null}
    />
    {addDate && <AddEventSheet groups={groups} date={addDate} onClose={() => setAddDate(null)} onCreated={() => {
      void loadMonth(addDate.slice(0, 7), true);
      setAddDate(null);
    }} />}
  </>;
}
