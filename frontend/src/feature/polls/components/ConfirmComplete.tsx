import { useEffect, useRef } from 'react';
import { Icon } from '../../../components/Icon';
import { toast } from '../../../components/Toaster';
import { dateLabel, timeLabel } from '../../../lib/date';
import type { Poll } from '../lib/poll';

export function ConfirmComplete({ poll, index, calendarAdded }: { poll: Poll; index: number; calendarAdded: boolean }) {
  const candidate = poll.candidates[index]!;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    heading.current?.focus();
  }, []);
  const shareText = `${poll.title}は${dateLabel(candidate.date)} ${timeLabel(candidate.time)}に決まりました`;
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: poll.title, text: shareText });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return; // キャンセル時はコピーに倒さない
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      toast('決まった日程をコピーしました');
    } catch {
      toast(shareText);
    }
  };
  return <section className="confirm-complete" aria-labelledby="confirm-complete-heading">
    <h1 id="confirm-complete-heading" ref={heading} tabIndex={-1}>日程が決まりました</h1>
    <div className="confirm-event">
      <span className="confirm-event-icon"><Icon name="calendar" size={46} /></span>
      <h2>{poll.title}</h2>
      <p>{dateLabel(candidate.date)} {timeLabel(candidate.time)}</p>
    </div>
    {calendarAdded && <div className="calendar-added" role="status">
      <Icon name="check" size={20} />
      <p><strong>{poll.group.name}のカレンダーに追加しました</strong><span>参加メンバーと同じ予定を確認できます。</span></p>
    </div>}
    <button type="button" className="ghost-btn wide" onClick={share}><Icon name="share" size={18} />決まった日程を共有</button>
    {calendarAdded && <a className="primary-btn wide confirm-calendar-link" href={`/?date=${candidate.date}`}><Icon name="calendar" size={18} />カレンダーで見る</a>}
  </section>;
}
