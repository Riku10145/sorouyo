import { useEffect, useState } from 'react';
import { fetchGroups, type GroupInfo } from '../../../api/groups';
import { AppShell } from '../../../components/AppShell';
import { MobileHeader } from '../../../components/MobileHeader';
import { Icon } from '../../../components/Icon';
import { LoginCard } from '../../../components/LoginCard';
import { useMe } from '../../../hooks/useMe';
import type { DisplayGroup } from '../../../lib/groups';
import { fetchPolls, type PollSummary } from '../api/polls';
import { PollRow } from '../components/PollRow';

/** /polls 日程調整一覧 */
export function Polls() {
  const me = useMe();
  const [groups, setGroups] = useState<GroupInfo[] | 'error' | null>(null);
  const [polls, setPolls] = useState<PollSummary[] | 'error' | null>(null);
  const [visible, setVisible] = useState<ReadonlySet<string>>();

  useEffect(() => {
    if (!me) return;
    void (async () => {
      const [groupList, pollList] = await Promise.all([fetchGroups(), fetchPolls()]);
      setGroups(groupList ?? 'error');
      setPolls(pollList.polls ?? 'error');
    })().catch(() => { setGroups('error'); setPolls('error'); });
  }, [me]);

  if (me === undefined) return null;
  if (me === null) {
    return <AppShell active="polls" selectedDate="" groups={[]} subpage>
      <LoginCard next="/polls" />
      <p className="hint" style={{ margin: '0 16px' }}><a href="/polls/sample">サンプルの日程調整画面を見る</a></p>
    </AppShell>;
  }

  const displayGroups: DisplayGroup[] = Array.isArray(groups) ? groups.map(g => ({ id: g.id, name: g.name, color: g.color })) : [];
  const shown = Array.isArray(polls) ? polls.filter(poll => !visible || visible.has(poll.group.id)) : [];
  const toggle = (id: string) => setVisible(current => {
    const next = new Set(current ?? displayGroups.map(g => g.id));
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return <AppShell active="polls" selectedDate="" groups={displayGroups} visible={visible} onToggleGroup={displayGroups.length > 1 ? toggle : undefined}>
    <MobileHeader />
    <h1 className="page-title">日程調整</h1>
    <div className="groups-body">
      {polls === 'error' ? <p className="form-error" role="alert">読み込めませんでした。時間をおいて再度お試しください。</p>
        : polls === null ? <p className="loading-note">読み込み中…</p> : <>
        {shown.length === 0 && (polls.length === 0 ? <section className="empty-hero">
          <h2>まだ日程調整がありません</h2>
          <p>候補日をまとめて選んで、LINEなどに貼れる回答リンクを作れます。</p>
        </section> : <p className="hint">表示中のグループに日程調整はありません。</p>)}
        <ul className="group-list">
          {shown.map(poll => <li key={poll.id}><PollRow poll={poll} /></li>)}
        </ul>
        {groups !== null && (groups === 'error'
          ? <p className="form-error" role="alert">グループを読み込めませんでした。</p>
          : (groups.length > 0
            ? <a className="primary-btn wide" href="/polls/new"><Icon name="plus" size={18} />日程調整を作成</a>
            : <p className="hint"><a href="/groups">まずグループを作成してください</a></p>))}
      </>}
    </div>
  </AppShell>;
}
