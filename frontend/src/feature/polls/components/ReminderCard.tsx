import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import { toast } from '../../../components/Toaster';
import { dateLabel } from '../../../lib/date';
import type { Poll } from '../lib/poll';

interface ReminderMember { id: string; name: string; answered: boolean }

/** #7 未回答のメンバーだけへの催促。対象を選び、回答リンク付きの文面を共有・コピーする */
export function ReminderCard({ poll, members, linkUrl }: { poll: Poll; members: ReminderMember[]; linkUrl: () => Promise<string> }) {
  const unanswered = members.filter(member => !member.answered);
  const [checked, setChecked] = useState<readonly string[]>(unanswered.map(member => member.id));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) =>
    setChecked(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const share = async () => {
    const names = unanswered.filter(member => checked.includes(member.id)).map(member => member.name);
    if (!names.length) { toast('催促する人を選んでください'); return; }
    setBusy(true);
    const url = await linkUrl();
    setBusy(false);
    if (!url) { toast('回答リンクを作れませんでした'); return; }
    const deadline = poll.deadline ? `締切は${dateLabel(poll.deadline.date)}${poll.deadline.time}です。` : '';
    const text = `【${poll.title}】日程調整のお願い\n${names.join('さん、')}さん、まだ回答をお待ちしています。${deadline}\nこちらのリンクから○△×でお答えください。\n${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('催促文をコピーしました');
    } catch {
      toast(text);
    }
  };
  return <section className="card reminder-card" aria-labelledby="reminder-heading">
    <h2 id="reminder-heading">未回答のメンバーに催促</h2>
    <p className="note">回答リンク付きの催促文を作ります。{members.length - unanswered.length}人は回答済みのため対象に入りません。</p>
    <ul className="reminder-list">
      {unanswered.map(member => <li key={member.id}>
        <label className="reminder-row">
          <input type="checkbox" checked={checked.includes(member.id)} onChange={() => toggle(member.id)} />
          <span>{member.name}</span>
        </label>
      </li>)}
    </ul>
    <button type="button" className="soft-btn wide" disabled={busy} onClick={() => void share()}>
      <Icon name="share" size={18} />{busy ? '作成中…' : '催促文を共有・コピー'}
    </button>
  </section>;
}
