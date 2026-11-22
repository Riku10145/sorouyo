import type { ReactNode } from 'react';
import { Brand, Dot, Icon, notReady, type DisplayGroup } from '../design/ui';
import type { IconName } from '../design/art';
import { dateLabel } from '../../shared/model';

export type Tab = 'calendar' | 'polls' | 'groups';
const NAV: readonly { id: Tab | 'plan'; label: string; icon: IconName; href?: string }[] = [
  { id: 'calendar', label: 'カレンダー', icon: 'calendarTab', href: '/' },
  { id: 'polls', label: '日程調整', icon: 'pollTab', href: '/polls' },
  { id: 'groups', label: 'グループ', icon: 'groupsTab', href: '/groups' },
  { id: 'plan', label: 'プラン', icon: 'plan' },
];

function NavItems({ active, className }: { active: Tab; className: string }) {
  return <>{NAV.map(item => item.href
    ? <a key={item.id} className={className} href={item.href} aria-current={item.id === active ? 'page' : undefined}><Icon name={item.icon} size={22} /><span>{item.label}</span></a>
    : <button key={item.id} type="button" className={className} onClick={() => notReady(item.label)}><Icon name={item.icon} size={22} /><span>{item.label}</span></button>)}</>;
}

export interface SideEvent { id?: string; title: string; time?: string | null; group: DisplayGroup }

export function AppShell({ active, selectedDate, groups, visible, onToggleGroup, dayEvents, subpage, children }: {
  active: Tab; selectedDate: string; groups: DisplayGroup[];
  visible?: ReadonlySet<string>; onToggleGroup?: (group: string) => void;
  dayEvents?: SideEvent[]; subpage?: boolean; children: ReactNode;
}) {
  return <div className={subpage ? 'app-shell subpage' : 'app-shell'}>
    <aside className="sidebar" aria-label="メニュー">
      <Brand size={32} />
      <nav className="side-nav" aria-label="メイン"><NavItems active={active} className="side-link" /></nav>
      {groups.length > 0 && <section className="side-groups" aria-labelledby="side-groups-heading">
        <h2 id="side-groups-heading">表示するグループ</h2>
        <ul>{groups.map(group => <li key={group.id}>
          <label><input type="checkbox" checked={!visible || visible.has(group.id)} disabled={!onToggleGroup} onChange={() => onToggleGroup?.(group.id)} /><Dot group={group} />{group.name}</label>
        </li>)}</ul>
      </section>}
      {selectedDate && <section className="side-day" aria-label="選択した日の予定">
        <h2>{dateLabel(selectedDate)}の予定</h2>
        {dayEvents?.length ? <ul>{dayEvents.map((event, i) => <li key={event.id ?? i}><Dot group={event.group} /><span className="num">{event.time ?? '終日'}</span>{event.title}</li>)}</ul> : <p>予定はありません</p>}
      </section>}
      <a className="side-settings" href="/settings"><Icon name="settings" size={18} />設定<Icon name="chevronRight" size={16} /></a>
    </aside>
    <main className="app-main">{children}</main>
    {!subpage && <nav className="bottom-nav" aria-label="メイン"><NavItems active={active} className="bottom-link" /></nav>}
  </div>;
}
