import { useEffect, useState } from 'react';
import { AppShell } from '../../../components/AppShell';
import { Dot } from '../../../components/Dot';
import { GroupForm } from '../../../components/GroupForm';
import { Icon } from '../../../components/Icon';
import { LoginCard } from '../../../components/LoginCard';
import { toast } from '../../../components/Toaster';
import { useMe } from '../../../hooks/useMe';
import type { DisplayGroup } from '../../../lib/groups';
import { fetchGroup, updateGroup, type GroupDetail as Detail } from '../api';
import { GroupMembers } from '../components/GroupMembers';
import { DeleteGroup } from '../components/DeleteGroup';

export function GroupDetail({ id, selectedDate }: { id: string; selectedDate: string }) {
  const me = useMe();
  const [detail, setDetail] = useState<Detail | 'loading' | 'denied'>('loading');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!me) return;
    let active = true;
    fetchGroup(id).then(({ detail }) => {
      if (!active) return;
      setDetail(detail ?? 'denied');
    }).catch(() => { if (active) setDetail('denied'); });
    return () => { active = false; };
  }, [id, me]);

  if (me === undefined) return null;
  if (me === null) {
    return <AppShell active="groups" selectedDate={selectedDate} groups={[]} subpage>
      <LoginCard next={`/groups/${id}`} />
    </AppShell>;
  }
  if (detail === 'loading') return null;
  if (detail === 'denied') {
    return <AppShell active="groups" selectedDate={selectedDate} groups={[]} subpage>
      <section className="notice-card" role="alert" style={{ margin: '24px 16px' }}>
        <Icon name="link" size={32} /><h2>グループを開けません</h2>
        <p>権限がないか、削除された可能性があります。</p>
        <a className="soft-btn" href="/groups">グループ一覧へ</a>
      </section>
    </AppShell>;
  }

  const { group, counts } = detail;
  const display: DisplayGroup = group;
  const admin = group.role === 'admin';
  return <AppShell active="groups" selectedDate={selectedDate} groups={[display]} subpage>
    <div className="m-only m-back"><a className="text-btn" href="/groups"><Icon name="chevronLeft" size={20} />グループ</a></div>
    <div className="groups-body">
      <section className="card group-head">
        <h1><Dot group={display} />{group.name}</h1>
        <p>{counts.members}人のメンバー ・ 予定{counts.events}件 ・ 日程調整{counts.polls}件</p>
      </section>

      {admin && <section className="card">
        <h2>グループを編集</h2>
        {editing
          ? <GroupForm initial={{ name: group.name, color: group.color }} submitLabel="保存する" onSubmit={async (name, color) => {
            const updated = await updateGroup(group.id, name, color);
            if (!updated) return '保存できませんでした';
            setDetail({ ...detail, group: { ...group, name: updated.name, color: updated.color } });
            setEditing(false);
            toast('グループを更新しました');
            return null;
          }} onCancel={() => setEditing(false)} />
          : <button type="button" className="ghost-btn" onClick={() => setEditing(true)}><Icon name="settings" size={18} />名前・色を変更</button>}
      </section>}
      <GroupMembers detail={detail} />
      {admin && <DeleteGroup group={group} counts={counts} />}
    </div>
  </AppShell>;
}
