import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { DAYS, dateFromKey, dateKey, dateLabel, dayTone, monthCells, shiftedMonth } from '../../shared/model';
import { GROUPS, SAMPLE_EVENTS, groupName, type GroupId } from '../../shared/sample';
import { monthArt } from '../design/art';
import { Brand, EventPill, Icon, StampArt, notReady } from '../design/ui';
import { AppShell } from './Shell';

const ALL = new Set<GroupId>(GROUPS.map(group => group.id));

export function Home({ today, initialDate }: { today: string; initialDate: string }) {
  const [selected, setSelected] = useState(initialDate);
  const [month, setMonth] = useState(initialDate.slice(0, 7));
  const [visible, setVisible] = useState<ReadonlySet<GroupId>>(ALL);
  const events = SAMPLE_EVENTS.filter(event => visible.has(event.group));
  const eventsOn = (date: string) => events.filter(event => event.date === date);
  const cells = monthCells(month);
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const Art = monthArt[monthNumber - 1]!;
  const dayEvents = eventsOn(selected);
  const toggle = (group: GroupId) => setVisible(current => {
    const next = new Set(current);
    if (next.has(group)) next.delete(group); else next.add(group);
    return next;
  });
  const go = (date: string) => { setSelected(date); setMonth(date.slice(0, 7)); };
  const grid = useRef<HTMLDivElement>(null);
  const keyMoved = useRef(false);
  useEffect(() => {
    if (!keyMoved.current) return;
    keyMoved.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-date="${selected}"]`)?.focus();
  }, [selected]);
  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[event.key];
    if (!step) return;
    event.preventDefault();
    const from = (event.target as HTMLElement).closest<HTMLElement>('[data-date]')?.dataset.date ?? selected;
    const next = dateFromKey(from);
    next.setDate(next.getDate() + step);
    keyMoved.current = true;
    go(dateKey(next));
  };
  const focusable = cells.includes(selected) ? selected : cells.find(date => date.startsWith(month));

  return <AppShell active="calendar" selectedDate={selected} visible={visible} onToggleGroup={toggle}>
    <header className="m-header">
      <Brand />
      <button type="button" className="text-btn" onClick={() => notReady('設定')}><Icon name="settings" size={20} />設定</button>
    </header>
    <div className="group-tabs" role="toolbar" aria-label="表示するグループ">
      <button type="button" aria-pressed={visible.size === ALL.size} onClick={() => setVisible(ALL)}>すべて</button>
      {GROUPS.map(group => <button type="button" key={group.id} aria-pressed={visible.size < ALL.size && visible.has(group.id)}
        onClick={() => setVisible(new Set([group.id]))}><span className={`dot g-${group.id}`} aria-hidden="true" />{group.name}</button>)}
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
          <button type="button" className="icon-btn ghost-btn" aria-label="前の月" onClick={() => setMonth(shiftedMonth(month, -1))}><Icon name="chevronLeft" /><span className="desk-only">前月</span></button>
          <button type="button" className="icon-btn ghost-btn" aria-label="次の月" onClick={() => setMonth(shiftedMonth(month, 1))}><Icon name="chevronRight" /><span className="desk-only">翌月</span></button>
          <a className="ghost-btn desk-only" href="/polls/sample"><Icon name="pollTab" size={18} />日程調整を作成</a>
          <button type="button" className="primary-btn desk-only" onClick={() => notReady('予定の追加')}><Icon name="plus" size={18} />予定を追加</button>
        </div>
      </div>
      <div className="calendar" role="grid" ref={grid} onKeyDown={onGridKey} aria-label={`${year}年${monthNumber}月のカレンダー`}>
        <div className="cal-row cal-head" role="row">{DAYS.map((day, i) => <span role="columnheader" key={day} className={i === 0 ? 'sun' : i === 6 ? 'sat' : ''}>{day}</span>)}</div>
        {Array.from({ length: cells.length / 7 }, (_, week) => <div className="cal-row" role="row" key={week}>
          {cells.slice(week * 7, week * 7 + 7).map(date => {
            const list = eventsOn(date);
            const names = list.map(event => `${groupName(event.group)} ${event.time ?? ''}${event.title}`).join('、');
            return <button type="button" role="gridcell" key={date} data-date={date} tabIndex={date === focusable ? 0 : -1} onClick={() => go(date)}
              className={`cal-cell ${dayTone(date) ?? ''} ${date.startsWith(month) ? '' : 'outside'}`}
              aria-selected={date === selected} aria-current={date === today ? 'date' : undefined}
              aria-label={`${dateLabel(date)}${list.length ? `、予定${list.length}件：${names}` : ''}`}>
              <span className="cal-num">{Number(date.slice(8))}</span>
              <span className="cal-pills" aria-hidden="true">
                {list.slice(0, 1).map((event, i) => <span key={i} className="m-only"><EventPill event={event} /></span>)}
                {list.length > 1 && <span className="more m-only">+{list.length - 1}</span>}
                {list.slice(0, 3).map((event, i) => <span key={i} className="desk-only"><EventPill event={event} long /></span>)}
              </span>
            </button>;
          })}
        </div>)}
      </div>
    </section>

    <section className="day-panel" aria-labelledby="day-heading">
      <div className="day-head">
        <h2 id="day-heading">{dateLabel(selected)}<span className="count">{dayEvents.length}件</span></h2>
        <button type="button" className="primary-btn" onClick={() => notReady('予定の追加')}><Icon name="plus" size={18} />予定を追加</button>
      </div>
      {dayEvents.length ? <ul className="day-list">{dayEvents.map((event, i) => <li key={i} className="day-item">
        <span className="day-time num">{event.time ?? '終日'}</span>
        <span className={`day-bar g-${event.group}`} aria-hidden="true" />
        <span className="day-text"><strong>{event.title}</strong><span>{groupName(event.group)}</span></span>
        <StampArt event={event} />
      </li>)}</ul> : <p className="empty">この日の予定はまだありません。</p>}
    </section>
  </AppShell>;
}

export const todayInTokyo = (): string => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
