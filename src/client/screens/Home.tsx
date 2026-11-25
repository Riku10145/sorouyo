import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { DAYS, dateFromKey, dateKey, dateLabel, dayTone, monthCells, shiftedMonth } from '../../shared/model';
import { GROUPS, SAMPLE_EVENTS, groupName, type CalendarEvent, type Stamp } from '../../shared/sample';
import { monthArt, stamps } from '../design/art';
import { Brand, Dot, Icon, notReady, toast, type DisplayGroup, groupCls, groupVars } from '../design/ui';
import { createEvent, createGroup, fetchCalendar, fetchGroups, useMe, type CalEvent, type GroupInfo } from '../api';
import { AppShell, type SideEvent } from './Shell';
import { GroupForm } from './Groups';
import { monthSelection } from './monthSelection';

export const todayInTokyo = (): string => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

interface ViewEvent {
  id?: string; date: string; title: string; short?: string;
  time?: string | null; stamp?: Stamp; group: DisplayGroup;
}

type MonthLoad = { status: 'loading' } | { status: 'error' } | { status: 'loaded'; events: ViewEvent[] };

const sampleView = (events: readonly CalendarEvent[]): ViewEvent[] =>
  events.map(event => ({
    ...event,
    group: { id: event.group, name: groupName(event.group), className: event.group },
  }));

function Pill({ event, long = false }: { event: ViewEvent; long?: boolean }) {
  const label = long ? `${event.time ? event.time + ' ' : ''}${event.title}` : event.short ?? event.title;
  return <span className={`pill ${groupCls(event.group)}`} style={groupVars(event.group)} title={`${event.group.name}：${event.title}`}>{label}</span>;
}

function CalendarView({ today, initialDate, groups, events, monthStatus, onRetry, onMonthChange, onAdd, dayLink }: {
  today: string; initialDate: string; groups: DisplayGroup[]; events: ViewEvent[];
  monthStatus?: MonthLoad['status'];
  onRetry?: () => void;
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
  const dayNotice = monthStatus === 'error' ? <div className="day-load-error">
    <div className="form-error" role="alert">予定を読み込めませんでした。</div>
    {onRetry && <button type="button" className="ghost-btn" onClick={onRetry}>再試行</button>}
  </div> : monthStatus === 'loading' ? <p className="empty" role="status">予定を読み込み中…</p> : null;
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
  useLayoutEffect(() => {
    if (!restoreCellFocus.current) return;
    restoreCellFocus.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-date="${selected}"]`)?.focus();
  }, [selected]);
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
    if (!date.startsWith(month)) restoreCellFocus.current = true;
    go(date);
    if (window.innerWidth < 1024) {
      // スマホでは選択日の一覧が画面外にありうる。1タップで全文まで読めるようパネルへ移す
      requestAnimationFrame(() => dayPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };
  const focusable = cells.includes(selected) ? selected : cells.find(date => date.startsWith(month));
  const add = (trigger: HTMLButtonElement) => onAdd ? onAdd(selected, trigger) : notReady('予定の追加');
  const sideEvents: SideEvent[] = dayEvents.map(event => ({ id: event.id, title: event.title, time: event.time, group: event.group, link: dayLink?.(event) ?? undefined }));

  return <AppShell active="calendar" selectedDate={selected} groups={groups} visible={visible} onToggleGroup={groups.length > 1 ? toggle : undefined} dayEvents={sideEvents} dayNotice={dayNotice}>
    <header className="m-header">
      <Brand />
      <a className="text-btn" href="/settings"><Icon name="settings" size={20} />設定</a>
    </header>
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

const toView = (event: CalEvent): ViewEvent => ({
  id: event.id, date: event.date, title: event.title, time: event.startTime,
  group: { id: event.group.id, name: event.group.name, color: event.group.color },
});

function AddEventSheet({ groups, date, onClose, onCreated }: {
  groups: GroupInfo[]; date: string; onClose: () => void; onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sheet = useRef<HTMLFormElement>(null);

  useLayoutEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      // IME変換中のキー（変換キャンセルのEscape・候補選択のTab）はシートを操作しない
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      const form = sheet.current;
      if (e.key !== 'Tab' || !form) return;

      const controls = Array.from(form.querySelectorAll<HTMLElement>('input, select, button'))
        .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = document.activeElement;
      if (!form.contains(active) || active === (e.shiftKey ? first : last)) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('タイトルを入力してください'); return; }
    setBusy(true);
    const created = await createEvent(groupId, { date, title: title.trim(), time: time || null }).catch(() => null);
    setBusy(false);
    if (!created) { setError('保存できませんでした'); return; }
    toast('予定を追加しました');
    onCreated();
  };

  return <div className="sheet-backdrop" onClick={onClose} role="presentation">
    <form ref={sheet} className="sheet card" onSubmit={submit} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${dateLabel(date)}の予定を追加`}>
      <h2>{dateLabel(date)}の予定を追加</h2>
      <label className="field">タイトル<input value={title} onChange={e => setTitle(e.target.value)} maxLength={60} autoFocus /></label>
      <label className="field">グループ<select value={groupId} onChange={e => setGroupId(e.target.value)}>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <label className="field">時刻（空欄なら終日）<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
      {error && <p className="form-error">{error}</p>}
      <div className="about-actions">
        <button type="button" className="ghost-btn" onClick={onClose}>キャンセル</button>
        <button type="submit" className="primary-btn" disabled={busy}>{busy ? '保存中…' : '追加する'}</button>
      </div>
    </form>
  </div>;
}

function RemoteHome({ today, initialDate }: { today: string; initialDate: string }) {
  const [groups, setGroups] = useState<GroupInfo[] | 'error' | null>(null);
  const [months, setMonths] = useState<Map<string, MonthLoad>>(new Map());
  const [viewMonth, setViewMonth] = useState(initialDate.slice(0, 7));
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
        <GroupForm submitLabel="グループを作成" onSubmit={async (name, color) => {
          const group = await createGroup(name, color);
          if (!group) return '作成できませんでした';
          setGroups([group]);
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
      monthStatus={months.get(viewMonth)?.status ?? 'loading'}
      onRetry={() => void loadMonth(viewMonth, true)}
      onMonthChange={month => {
        setViewMonth(month);
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
      void loadMonth(viewMonth, true);
      setAddDate(null);
    }} />}
  </>;
}

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
  return <RemoteHome today={today} initialDate={initialDate} />;
}
