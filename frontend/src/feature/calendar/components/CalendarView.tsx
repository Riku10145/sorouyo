import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AppShell, type SideEvent } from '../../../components/AppShell';
import { MobileHeader } from '../../../components/MobileHeader';
import { Dot } from '../../../components/Dot';
import { Icon } from '../../../components/Icon';
import { notReady } from '../../../components/Toaster';
import { monthArt, stamps } from '../../../design/art';
import { DAYS, dateFromKey, dateKey, dateLabel, dayTone, monthCells } from '../../../lib/date';
import { groupCls, groupVars, type DisplayGroup } from '../../../lib/groups';
import type { ViewEvent, MonthLoad } from '../lib/calendar';
import { monthSelection } from '../lib/monthSelection';

function Pill({ event, long = false }: { event: ViewEvent; long?: boolean }) {
  const label = long ? `${event.time ? event.time + ' ' : ''}${event.title}` : event.short ?? event.title;
  return <span className={`pill ${groupCls(event.group)}`} style={groupVars(event.group)} title={`${event.group.name}：${event.title}`}>{label}</span>;
}

export function CalendarView({ today, initialDate, groups, events, monthStatus, onRetry, onMonthChange, onAdd, dayLink }: {
  today: string; initialDate: string; groups: DisplayGroup[]; events: ViewEvent[];
  monthStatus?: (month: string) => MonthLoad['status'];
  onRetry?: (month: string) => void;
  onMonthChange?: (month: string) => void;
  onAdd?: (date: string, trigger: HTMLButtonElement) => void;
  dayLink?: (event: ViewEvent) => string | null;
}) {
  const [selected, setSelected] = useState(initialDate);
  const [month, setMonth] = useState(initialDate.slice(0, 7));
  const [visible, setVisible] = useState<ReadonlySet<string>>(() => new Set(groups.map(g => g.id)));
  const shown = events.filter(event => visible.has(event.group.id));
  const eventsOn = (date: string) => shown.filter(event => event.date === date);
  const cells = monthCells(month);
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const Art = monthArt[monthNumber - 1]!;
  const dayEvents = eventsOn(selected);
  const selectedMonth = selected.slice(0, 7);
  const selectedMonthStatus = monthStatus?.(selectedMonth);
  const dayNotice = selectedMonthStatus === 'error' ? <div className="day-load-error">
    <div className="form-error" role="alert">予定を読み込めませんでした。</div>
    {onRetry && <button type="button" className="ghost-btn" onClick={() => onRetry(selectedMonth)}>再試行</button>}
  </div> : selectedMonthStatus === 'loading' ? <p className="empty" role="status">予定を読み込み中…</p> : null;
  const toggle = (group: string) => setVisible(current => {
    const next = new Set(current);
    if (next.has(group)) next.delete(group); else next.add(group);
    return next;
  });
  const changeMonth = (next: string) => { setMonth(next); onMonthChange?.(next); };
  const go = (date: string) => { setSelected(date); changeMonth(date.slice(0, 7)); };
  const grid = useRef<HTMLDivElement>(null);
  const dayPanel = useRef<HTMLElement>(null);
  const restoreCellFocus = useRef(false);
  const [panelScrollRequest, setPanelScrollRequest] = useState(0);
  useLayoutEffect(() => {
    if (!restoreCellFocus.current) return;
    restoreCellFocus.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-date="${selected}"]`)?.focus();
  }, [selected]);
  useLayoutEffect(() => {
    if (!panelScrollRequest || window.innerWidth >= 1024) return;
    // 状態更新後のDOMへ移す。スマホでは選択日の一覧が画面外にありうるため、1タップで全文まで読めるようにする
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    dayPanel.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }, [panelScrollRequest]);
  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[event.key];
    if (!step) return;
    event.preventDefault();
    const from = (event.target as HTMLElement).closest<HTMLElement>('[data-date]')?.dataset.date ?? selected;
    const next = dateFromKey(from);
    next.setDate(next.getDate() + step);
    restoreCellFocus.current = true;
    go(dateKey(next));
  };
  const onCellClick = (date: string) => {
    // タップでは表示中の月を保つ。隣月のセルもその月の一部として選び、内容は下の一覧で確認させる
    setSelected(date);
    if (window.innerWidth < 1024) setPanelScrollRequest(request => request + 1);
  };
  const focusable = cells.includes(selected) ? selected : cells.find(date => date.startsWith(month));
  const add = (trigger: HTMLButtonElement) => onAdd ? onAdd(selected, trigger) : notReady('予定の追加');
  const sideEvents: SideEvent[] = dayEvents.map(event => ({ id: event.id, title: event.title, time: event.time, group: event.group, link: dayLink?.(event) ?? undefined }));

  return <AppShell active="calendar" selectedDate={selected} groups={groups} visible={visible} onToggleGroup={groups.length > 1 ? toggle : undefined} dayEvents={sideEvents} dayNotice={dayNotice}>
    <MobileHeader />
    <div className="group-tabs" role="group" aria-label="表示するグループ">
      <button type="button" aria-pressed={visible.size === groups.length} onClick={() => setVisible(new Set(groups.map(g => g.id)))}>すべて</button>
      {groups.map(group => <button type="button" key={group.id} aria-pressed={visible.size < groups.length && visible.has(group.id)}
        onClick={() => setVisible(new Set([group.id]))}><Dot group={group} />{group.name}</button>)}
    </div>

    <section className="calendar-area" aria-labelledby="month-heading">
      <div className="month-bar">
        <h1 id="month-heading" className="month-title">
          <span className="month-year">{year}年</span>
          <span className="month-number">{monthNumber}<small>月</small></span>
        </h1>
        <Art className="month-art" width={60} height={45} />
        <div className="month-actions">
          <button type="button" className="text-btn ghost-btn" onClick={() => go(today)}>今日</button>
          <button type="button" className="icon-btn ghost-btn" aria-label="前の月" onClick={() => go(monthSelection(month, -1, today))}><Icon name="chevronLeft" /><span className="desk-only">前月</span></button>
          <button type="button" className="icon-btn ghost-btn" aria-label="次の月" onClick={() => go(monthSelection(month, 1, today))}><Icon name="chevronRight" /><span className="desk-only">翌月</span></button>
          <a className="ghost-btn desk-only" href="/polls/new"><Icon name="pollTab" size={18} />日程調整を作成</a>
          <button type="button" className="primary-btn desk-only" onClick={e => add(e.currentTarget)}><Icon name="plus" size={18} />予定を追加</button>
        </div>
      </div>
      <div className="calendar" role="grid" ref={grid} onKeyDown={onGridKey} aria-label={`${year}年${monthNumber}月のカレンダー`}>
        <div className="cal-row cal-head" role="row">{DAYS.map((day, i) => <span role="columnheader" key={day} className={i === 0 ? 'sun' : i === 6 ? 'sat' : ''}>{day}</span>)}</div>
        {Array.from({ length: cells.length / 7 }, (_, week) => <div className="cal-row" role="row" key={week}>
          {cells.slice(week * 7, week * 7 + 7).map(date => {
            const list = eventsOn(date);
            const names = list.map(event => `${event.group.name} ${event.time ?? ''}${event.title}`).join('、');
            return <button type="button" role="gridcell" key={date} data-date={date} tabIndex={date === focusable ? 0 : -1} onClick={() => onCellClick(date)}
              className={`cal-cell ${dayTone(date) ?? ''} ${date.startsWith(month) ? '' : 'outside'}`}
              aria-selected={date === selected} aria-current={date === today ? 'date' : undefined}
              aria-label={`${dateLabel(date)}${list.length ? `、予定${list.length}件：${names}` : ''}`}>
              <span className="cal-num">{Number(date.slice(8))}</span>
              <span className="cal-pills" aria-hidden="true">
                {list.slice(0, 1).map((event, i) => <span key={event.id ?? i} className="m-only"><Pill event={event} /></span>)}
                {list.length > 1 && <span className="more m-only">+{list.length - 1}</span>}
                {list.slice(0, 3).map((event, i) => <span key={event.id ?? i} className="desk-only"><Pill event={event} long /></span>)}
              </span>
            </button>;
          })}
        </div>)}
      </div>
    </section>

    <section ref={dayPanel} className="day-panel" aria-labelledby="day-heading">
      <div className="day-head">
        <h2 id="day-heading">{dateLabel(selected)}{!dayNotice && <span className="count">{dayEvents.length}件</span>}</h2>
        <button type="button" className="primary-btn" onClick={e => add(e.currentTarget)}><Icon name="plus" size={18} />予定を追加</button>
      </div>
      {dayNotice ?? (dayEvents.length ? <ul className="day-list">{dayEvents.map((event, i) => {
        const link = dayLink?.(event);
        const body = <>
          <span className="day-time num">{event.time ?? '終日'}</span>
          <span className={`day-bar ${groupCls(event.group)}`} style={groupVars(event.group)} aria-hidden="true" />
          <span className="day-text"><strong>{event.title}</strong><span>{event.group.name}</span></span>
          {(() => { const Svg = event.stamp && stamps[event.stamp]; return Svg ? <Svg className="stamp" width={44} height={40} /> : null; })()}
          {link && <Icon name="chevronRight" size={18} />}
        </>;
        return <li key={event.id ?? i}>{link ? <a className="day-item" href={link}>{body}</a> : <div className="day-item">{body}</div>}</li>;
      })}</ul> : <p className="empty">この日の予定はまだありません。「予定を追加」から登録できます。</p>)}
    </section>
  </AppShell>;
}
