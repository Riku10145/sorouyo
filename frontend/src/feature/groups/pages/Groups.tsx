import { useEffect, useState } from 'react';
import { fetchGroups, type GroupInfo } from '../../../api/groups';
import { AppShell } from '../../../components/AppShell';
import { MobileHeader } from '../../../components/MobileHeader';
import { LoginCard } from '../../../components/LoginCard';
import { useMe } from '../../../hooks/useMe';
import { GroupList } from '../components/GroupList';

export function Groups() {
  const me = useMe();
  const wantsCreate = new URLSearchParams(window.location.search).get('create') === '1';
  const [groups, setGroups] = useState<GroupInfo[] | 'error' | null>(null);
  const loginNext = wantsCreate ? '/groups?create=1' : '/groups';

  useEffect(() => {
    if (!me) return;
    void fetchGroups().then(list => setGroups(list ?? 'error'));
  }, [me]);

  if (me === undefined) return null;
  if (me === null) {
    return <AppShell active="groups" selectedDate="" groups={[]} subpage>
      <LoginCard next={loginNext} />
    </AppShell>;
  }

  return <AppShell active="groups" selectedDate="" groups={[]}>
    <MobileHeader />
    <h1 className="page-title">グループ</h1>
    <div className="groups-body">
      {groups === 'error' ? <p className="form-error" role="alert">読み込めませんでした。時間をおいて再度お試しください。</p>
        : groups === null ? <p className="loading-note">読み込み中…</p> : <GroupList groups={groups} wantsCreate={wantsCreate} />}
    </div>
  </AppShell>;
}
