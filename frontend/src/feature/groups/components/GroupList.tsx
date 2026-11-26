import { useState } from 'react';
import { GROUP_CREATION_LIMIT } from '../../../../../shared/limits';
import { createGroup, type GroupInfo } from '../../../api/groups';
import { Dot } from '../../../components/Dot';
import { GroupForm } from '../../../components/GroupForm';
import { Icon } from '../../../components/Icon';
import { toast } from '../../../components/Toaster';

export function GroupList({ groups, wantsCreate }: { groups: GroupInfo[]; wantsCreate: boolean }) {
  const [creating, setCreating] = useState(wantsCreate);
  return <>
    {groups.length === 0 && !creating && <section className="empty-hero">
      <h2>まだグループがありません</h2>
      <p>家族や仲間ごとにグループを作ると、予定が色分けされて見やすくなります。</p>
    </section>}
    <ul className="group-list">
      {groups.map(group => <li key={group.id}>
        <a className="group-row card" href={`/groups/${group.id}`}>
          <Dot group={group} />
          <span className="group-row-main"><strong>{group.name}</strong><span className="role-badge">{group.role === 'admin' ? '管理者' : 'メンバー'}</span></span>
          <Icon name="chevronRight" size={18} />
        </a>
      </li>)}
    </ul>
    {creating
      ? <section className="card group-create"><h2>グループを作成</h2>
        <GroupForm submitLabel="作成する" showFreeNotice onSubmit={async (name, color) => {
          const created = await createGroup(name, color);
          if (created.status === 409) return `作成できるグループは${GROUP_CREATION_LIMIT}件までです。一覧から不要なグループを開き、作成済みが${GROUP_CREATION_LIMIT - 1}件以下になるまで削除すると、また作成できます。`;
          if (!created.group) return '作成できませんでした';
          toast('グループを作成しました');
          window.location.href = `/groups/${created.group.id}`;
          return null;
        }} />
      </section>
      : <button type="button" className="primary-btn wide" onClick={() => setCreating(true)}><Icon name="plus" size={18} />グループを作成</button>}
  </>;
}
