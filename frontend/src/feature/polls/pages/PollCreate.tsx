import { useEffect, useState } from 'react';
import { fetchGroups, type GroupInfo } from '../../../api/groups';
import { AppShell } from '../../../components/AppShell';
import { Icon } from '../../../components/Icon';
import { LoginCard } from '../../../components/LoginCard';
import { useMe } from '../../../hooks/useMe';
import { PollCreateForm } from '../components/PollCreateForm';

export function PollCreate() {
  const me = useMe();
  const [groups, setGroups] = useState<GroupInfo[] | 'error' | null>(null);
  useEffect(() => {
    if (!me) return;
    void fetchGroups().then(list => setGroups(list ?? 'error')).catch(() => setGroups('error'));
  }, [me]);

  if (me === undefined || (me !== null && groups === null)) return null;
  if (me === null) {
    return <AppShell active="polls" selectedDate="" groups={[]} subpage>
      <LoginCard next="/polls/new" />
    </AppShell>;
  }
  if (groups === 'error') {
    return <AppShell active="polls" selectedDate="" groups={[]} subpage>
      <p className="form-error" role="alert" style={{ margin: '24px 16px' }}>読み込めませんでした。時間をおいて再度お試しください。</p>
    </AppShell>;
  }
  if (!groups?.length) {
    return <AppShell active="polls" selectedDate="" groups={[]} subpage>
      <section className="notice-card" role="alert" style={{ margin: '24px 16px' }}>
        <Icon name="groupsTab" size={32} /><h2>まずグループを作成してください</h2>
        <p>日程調整はグループの予定として作ります。</p>
        <a className="soft-btn" href="/groups">グループページへ</a>
      </section>
    </AppShell>;
  }

  return <PollCreateForm groups={groups} />;
}
