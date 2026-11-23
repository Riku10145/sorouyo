import type { ReactNode } from 'react';
import { Brand, GroupDot, Icon, notReady } from '../design/ui';
import type { IconName } from '../design/art';
import { dateLabel } from '../../shared/model';
import { GROUPS, SAMPLE_EVENTS, type GroupId } from '../../shared/sample';

export type Tab = 'calendar' | 'polls';
const NAV: readonly { id: Tab | 'groups' | 'plan'; label: string; icon: IconName; href?: string }[] = [
  { id: 'calendar', label: 'カレンダー', icon: 'calendarTab', href: '/' },
  { id: 'polls', label: '日程調整', icon: 'pollTab', href: '/polls/sample' },
  { id: 'groups', label: 'グループ', icon: 'groupsTab' },
  { id: 'plan', label: 'プラン', icon: 'plan' },
];

function NavItems({ active, className }: { active: Tab; className: string }) {
  return <>{NAV.map(item => item.href
    ? <a key={item.id} className={className} href={item.href} aria-current={item.id === active ? 'page' : undefined}><Icon name={item.icon} size={22} /><span>{item.label}</span></a>
    : <button key={item.id} type="button" className={className} onClick={() => notReady(item.label)}><Icon name={item.icon} size={22} /><span>{item.label}</span></button>)}</>;
}

export function AppShell({ active, selectedDate, visible, onToggleGroup, subpage, children }: {
  active: Tab; selectedDate: string; visible?: ReadonlySet<GroupId>; onToggleGroup?: (group: GroupId) => void; subpage?: boolean; children: ReactNode;
}) {
  const dayEvents = SAMPLE_EVENTS.filter(event => event.date === selectedDate && (!visible || visible.has(event.group)));
  return <div className={subpage ? 'app-shell subpage' : 'app-shell'}>
    <aside className="sidebar" aria-label="メニュー">
      <Brand size={32} />
      <nav className="side-nav" aria-label="メイン"><NavItems active={active} className="side-link" /></nav>
      <section className="side-groups" aria-labelledby="side-groups-heading">
        <h2 id="side-groups-heading">表示するグループ</h2>
        <ul>{GROUPS.map(group => <li key={group.id}>
          <label>
            <input type="checkbox" checked={!visible || visible.has(group.id)} disabled={!onToggleGroup} onChange={() => onToggleGroup?.(group.id)} />
            <span className="side-group-name"><GroupDot group={group.id} />{group.name}</span>
          </label>
        </li>)}</ul>
      </section>
      <section className="side-day" aria-label="選択した日の予定">
        <h2>{dateLabel(selectedDate)}の予定</h2>
        {dayEvents.length ? <ul>{dayEvents.map((event, i) => <li key={i}><GroupDot group={event.group} /><span className="num">{event.time ?? '終日'}</span>{event.title}</li>)}</ul> : <p>予定はありません</p>}
      </section>
      <button type="button" className="side-settings" onClick={() => notReady('設定')}><Icon name="settings" size={18} />設定<Icon name="chevronRight" size={16} /></button>
    </aside>
    <main className="app-main">{children}</main>
    {!subpage && <nav className="bottom-nav" aria-label="メイン"><NavItems active={active} className="bottom-link" /></nav>}
  </div>;
}
