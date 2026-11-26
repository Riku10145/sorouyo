import { AppShell } from '../../../components/AppShell';
import { Icon } from '../../../components/Icon';
import { LoginCard } from '../../../components/LoginCard';
import { useMe } from '../../../hooks/useMe';
import { useMemberPoll } from '../hooks/useMemberPoll';
import { PollEditForm } from '../components/PollEditForm';

export function PollEdit({ id, selectedDate }: { id: string; selectedDate: string }) {
  const me = useMe();
  const result = useMemberPoll(id);
  if (me === undefined || result === 'loading') return null;
  if (me === null) {
    return <AppShell active="polls" selectedDate={selectedDate} groups={[]} subpage>
      <LoginCard next={`/polls/${id}/edit`} />
    </AppShell>;
  }
  if (!result.poll) {
    return <AppShell active="polls" selectedDate={selectedDate} groups={[]} subpage>
      <section className="notice-card" role="alert" style={{ margin: '24px 16px' }}>
        <Icon name="link" size={32} /><h2>調整を開けません</h2>
        <p>権限がないか、削除された可能性があります。</p>
        <a className="soft-btn" href="/polls">日程調整へ戻る</a>
      </section>
    </AppShell>;
  }

  const poll = result.poll;
  const owner = me.user.id === poll.creatorId;
  const group = { id: poll.group.id, name: poll.group.name, color: poll.group.color };
  if (!owner || poll.status !== 'open') {
    return <AppShell active="polls" selectedDate={selectedDate} groups={[group]} subpage>
      <section className="notice-card" role="alert" style={{ margin: '24px 16px' }}>
        <Icon name="pollTab" size={32} /><h2>{owner ? '確定済みの調整です' : '編集できません'}</h2>
        <p>{owner ? '編集や削除をする前に、調整画面で確定を取り消してください。' : '日程調整を編集できるのは主催者だけです。'}</p>
        <a className="soft-btn" href={`/polls/${id}`}>調整画面へ戻る</a>
      </section>
    </AppShell>;
  }
  return <AppShell active="polls" selectedDate={selectedDate} groups={[group]} subpage>
    <div className="m-only m-back"><a className="text-btn" href={`/polls/${id}`}><Icon name="chevronLeft" size={20} />日程調整</a></div>
    <h1 className="page-title">日程調整を編集</h1>
    <PollEditForm poll={poll} />
  </AppShell>;
}
