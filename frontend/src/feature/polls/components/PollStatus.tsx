import { useEffect, useRef, useState } from 'react';
import { AppShell } from '../../../components/AppShell';
import { Icon } from '../../../components/Icon';
import { toast } from '../../../components/Toaster';
import { dateLabel, shortDate, timeLabel, weekday, dayTone } from '../../../lib/date';
import type { DisplayGroup } from '../../../lib/groups';
import { type Poll, guestUrl, deadlineText } from '../lib/poll';
import { SAMPLE_ORGANIZER } from '../lib/sample';
import { answered, bestCandidate, tally } from '../lib/votes';
import { ConfirmComplete } from './ConfirmComplete';
import { InviteHero } from './InviteHero';
import { ReminderCard } from './ReminderCard';
import { VoteMark } from './Vote';

export type CopyLinkResult = { url: string } | { error: 'limit' | 'error' };

export function PollStatus({ poll, selectedDate, expired = false, canConfirm = true, canViewTally = true, members, viewerName, onConfirm, onUnconfirm, onCopyLink, onAnswerLink }: {
  poll: Poll; selectedDate: string; expired?: boolean;
  /** 確定権限がある操作者か（主催者のみ。メンバーには確定UIを出さない） */
  canConfirm?: boolean;
  /** 集計権限がある操作者か。メンバーには自分の回答状態だけを出す */
  canViewTally?: boolean;
  /** 催促対象の分類（#7）。作成者向けAPIだけが返す */
  members?: { id: string; name: string; answered: boolean }[];
  /** 回答前の自分を一覧に出すためのログイン中の表示名 */
  viewerName?: string;
  onConfirm?: (index: number) => Promise<string | null>;
  onUnconfirm?: (eventId: string) => Promise<boolean>;
  onCopyLink?: () => Promise<CopyLinkResult>;
  onAnswerLink?: () => void;
}) {
  const best = bestCandidate(poll);
  const [chosen, setChosen] = useState(best);
  const [confirmed, setConfirmed] = useState<number | null>(poll.confirmedIndex ?? null);
  const [confirmedEventId, setConfirmedEventId] = useState<string | null>(poll.confirmedEventId ?? null);
  const [completion, setCompletion] = useState<{ pollKey: string; index: number } | null>(null);
  const chosenCard = useRef<HTMLElement>(null);
  const picked = useRef(false);
  useEffect(() => { if (picked.current) { picked.current = false; chosenCard.current?.focus(); } }, [chosen]);
  useEffect(() => {
    const clearRestoredCompletion = (event: PageTransitionEvent) => {
      if (event.persisted) setCompletion(null);
    };
    window.addEventListener('pageshow', clearRestoredCompletion);
    return () => window.removeEventListener('pageshow', clearRestoredCompletion);
  }, []);
  const choose = (index: number) => { picked.current = true; setChosen(index); };
  const savedYou = poll.answers.find(answer => answer.own ?? answer.name === SAMPLE_ORGANIZER);
  // 実データでは未送信の回答行が無い。主催者/メンバーも回答対象なので、未回答の自分を一覧に補う
  const you = savedYou ?? { name: viewerName ?? 'あなた', votes: poll.candidates.map(() => null), own: true };
  const others = poll.answers.filter(answer => answer !== savedYou);
  const displayAnswers = savedYou ? poll.answers : [...poll.answers, you];
  const pollKey = poll.id ?? poll.token;
  const respondents = poll.answers.filter(answered).length;
  const candidate = poll.candidates[chosen]!;
  const confirmLabel = `${dateLabel(candidate.date).replace('（', '(').replace('）', ')')}に確定する`;
  const copyLinkResult = async (): Promise<CopyLinkResult> => onCopyLink ? await onCopyLink() : { url: guestUrl(poll) };
  const linkUrl = async () => {
    const result = await copyLinkResult();
    return 'url' in result ? result.url : '';
  };
  const copy = async () => {
    // iOS Safari はタップのジェスチャーが切れると書き込みを拒否するため、
    // リンク取得を待つ版は ClipboardItem に Promise を渡して先に書き込みを開始する
    if (onCopyLink && typeof ClipboardItem !== 'undefined') {
      try {
        const item = new ClipboardItem({
          'text/plain': copyLinkResult().then(result => {
            if ('error' in result) throw new Error(result.error);
            return new Blob([result.url], { type: 'text/plain' });
          }),
        });
        await navigator.clipboard.write([item]);
        toast('回答リンクをコピーしました');
        return;
      } catch { /* フォールバックに回す */ }
    }
    const result = await copyLinkResult();
    if ('error' in result) {
      toast(result.error === 'limit' ? 'この調整の回答リンクは発行上限に達しました' : '回答リンクを作れませんでした');
      return;
    }
    try { await navigator.clipboard.writeText(result.url); toast('回答リンクをコピーしました'); }
    catch { toast(`回答リンク：${result.url}`); }
  };
  const confirming = useRef(false);
  const confirm = async () => {
    if (confirmed !== null || confirming.current) return; // 確定後・確定処理中の再確定はさせない
    confirming.current = true;
    let eventId: string | null = null;
    let done = true;
    try {
      eventId = onConfirm ? await onConfirm(chosen) : null;
      done = onConfirm ? eventId !== null : true;
    }
    catch { done = false; } // ネットワークエラー等でも失敗トーストに倒す
    finally { confirming.current = false; }
    if (done) {
      setConfirmed(chosen);
      setConfirmedEventId(eventId);
      setCompletion({ pollKey, index: chosen });
    } else toast('確定できませんでした。すでに別の日に確定している可能性があります');
  };
  const unconfirming = useRef(false);
  const unconfirm = async () => {
    if (confirmed === null || unconfirming.current) return;
    if (!window.confirm('確定を取り消しますか？カレンダーの予定は消え、編集した予定名・メモは再確定時の新しい予定に引き継がれません。回答は保持されたまま再調整できます。')) return;
    unconfirming.current = true;
    let ok = true;
    try { ok = onUnconfirm && confirmedEventId ? await onUnconfirm(confirmedEventId) : !onUnconfirm; }
    catch { ok = false; }
    finally { unconfirming.current = false; }
    if (!ok) { toast('確定を取り消せませんでした'); return; }
    setConfirmed(null);
    setConfirmedEventId(null);
    toast('確定を取り消しました。新しい回答締切を設定してください');
    if (poll.id) window.location.href = `/polls/${poll.id}/edit?reopen=1`;
  };
  const expiredBanner = expired && confirmed === null && <p className="expired-note" role="status">
    <Icon name="clock" size={18} />{canConfirm ? '回答締切を過ぎました。回答は締め切られていますが、候補を選んで確定できます。' : '回答締切を過ぎました。回答は締め切られています。'}
  </p>;
  const progressText = canViewTally ? `${displayAnswers.length}人中${respondents}人が回答` : answered(you) ? 'あなたは回答済みです' : 'あなたは未回答です';
  const progress = <p className="progress">{canViewTally && <span className="bars" aria-hidden="true">{displayAnswers.map((_, i) => <i key={i} className={i < respondents ? 'on' : ''} />)}</span>}{progressText}</p>;
  const deadline = deadlineText(poll);

  const group: DisplayGroup = { id: poll.token || poll.title, name: poll.group.name, color: poll.group.color ?? null, className: poll.group.className };
  if (completion?.pollKey === pollKey) {
    // 完了画面はこの調整を確定した表示中だけに出す。再訪・別の調整では状態が残らない
    const completed = poll.candidates[completion.index]!;
    const completedEvent = { title: poll.title, time: completed.time || null, group };
    return <AppShell active="polls" selectedDate={completed.date} groups={[group]} dayEvents={onConfirm ? [completedEvent] : []} subpage>
      <div className="m-only m-back">
        <a className="text-btn" href="/polls"><Icon name="chevronLeft" size={20} />日程調整</a>
      </div>
      <ConfirmComplete poll={poll} index={completion.index} calendarAdded={!!onConfirm} />
    </AppShell>;
  }
  return <AppShell active="polls" selectedDate={selectedDate} groups={[group]} subpage>
    <div className="m-only m-back">
      <a className="text-btn" href="/polls"><Icon name="chevronLeft" size={20} />日程調整</a>
      <button type="button" className="text-btn" onClick={copy}><Icon name="copy" size={18} />リンク</button>
    </div>
    <div className="desk-only poll-toolbar">
      <p className="page-label">日程調整</p>
      <div className="toolbar-actions">
        {canConfirm && poll.id && <a className="ghost-btn" href={`/polls/${poll.id}/edit`}><Icon name="edit" size={18} />編集</a>}
        <button type="button" className="ghost-btn" onClick={copy}><Icon name="copy" size={18} />リンクをコピー</button>
        <button type="button" className="soft-btn" onClick={() => onAnswerLink ? onAnswerLink() : window.location.href = `/r#${poll.token}`}><Icon name="edit" size={18} />自分の回答を入力</button>
      </div>
    </div>
    <InviteHero poll={poll} eyebrow={`${poll.group.name}の日程調整`} footer={<p className="m-only hero-deadline">回答締切 {deadline}</p>}>
      <span className="m-only">{progress}</span>
      <p className="desk-only hero-meta">{progressText}<span aria-hidden="true">・</span>回答締切 {deadline}</p>
    </InviteHero>
    {expiredBanner}

    <section className="m-only poll-list" aria-labelledby="poll-list-heading">
      <div className="section-head">
        <h2 id="poll-list-heading">候補日の回答</h2>
        {canConfirm && poll.id && <a className="text-btn" href={`/polls/${poll.id}/edit`}><Icon name="edit" size={18} />編集</a>}
      </div>
      {poll.candidates.map((item, index) => ({ item, index })).sort((a, b) => Number(b.index === chosen) - Number(a.index === chosen)).map(({ item, index }) => {
        const count = tally(poll, index);
        const label = `${dateLabel(item.date)} ${timeLabel(item.time)}`;
        return index === chosen
          ? <article key={item.id ?? item.date} ref={chosenCard} tabIndex={-1} className="cand-card" aria-label={`${label}（選択中）`}>
            <div className="cand-top">
              <p className="cand-date"><span className="num">{shortDate(item.date)}</span><small className={dayTone(item.date)}>{weekday(item.date)}</small><span className="cand-time num">{timeLabel(item.time)}</span></p>
              <div className="cand-flags">{canViewTally && index === best && <span>参加できる人が最多</span>}{index === confirmed && <span className="chip-soft">確定</span>}<span className="chip-selected"><Icon name="check" size={14} />選択中</span></div>
            </div>
            <ul className="member-marks">
              {you && <li>{answered(you) ? <span className={`mark-circle v-${you.votes[index] ?? 'none'}`}><VoteMark vote={you.votes[index] ?? null} /></span> : <span className="badge-pending">未回答</span>}<strong>あなた</strong></li>}
              {others.map(answer => <li key={answer.name}><span className={`mark-circle v-${answer.votes[index] ?? 'none'}`}><VoteMark vote={answer.votes[index] ?? null} /></span><span>{answer.name}</span></li>)}
            </ul>
          </article>
          : <button type="button" key={item.id ?? item.date} className="cand-row" onClick={() => choose(index)} aria-label={`${label}${canViewTally ? `、参加${count.yes}、未定${count.maybe}、欠席${count.no}` : ''}。この候補日を選ぶ`}>
            <span className="cand-date"><span className="num">{shortDate(item.date)}</span><small className={dayTone(item.date)}>{weekday(item.date)}</small><span className="cand-time num">{timeLabel(item.time)}</span></span>
            {index === confirmed && <span className="chip-soft">確定</span>}
            {canViewTally && <span className="counts"><span>参加<b>{count.yes}</b></span><span>未定<b className="maybe">{count.maybe}</b></span><span>欠席<b className="no">{count.no}</b></span></span>}
            <Icon name="chevronRight" size={18} />
          </button>;
      })}
      {(!you || !answered(you)) && <div className="you-row"><p>あなたはまだ未回答です</p><button type="button" className="soft-btn clears-confirm-bar" onClick={() => onAnswerLink ? onAnswerLink() : window.location.href = `/r#${poll.token}`}><Icon name="edit" size={18} />回答する</button></div>}
    </section>

    <section className="desk-only matrix-card" aria-label="候補日ごとの回答">
      <table className="matrix">
        <thead><tr><th scope="col">メンバー</th>{poll.candidates.map((item, index) => <th scope="col" key={item.id ?? item.date}>
          <button type="button" className="matrix-date" aria-pressed={index === chosen} onClick={() => setChosen(index)}>
            <strong>{dateLabel(item.date)}</strong><span className="num">{timeLabel(item.time)}</span>{index === confirmed && <span className="chip-soft">確定</span>}{index === chosen && <span className="chip-soft">選択中</span>}
          </button></th>)}</tr></thead>
        <tbody>{displayAnswers.map(answer => <tr key={answer.id ?? (answer === you ? 'you' : answer.name)} className={answer === you ? 'you' : ''}>
          <th scope="row">{answer.name}{answer === you && '（あなた）'}{answer.comment?.trim() && <span className="matrix-comment">{answer.comment.trim()}</span>}</th>
          {poll.candidates.map((item, index) => <td key={item.id ?? item.date}><VoteMark vote={answer.votes[index] ?? null} withLabel /></td>)}
        </tr>)}</tbody>
      </table>
    </section>

    {canViewTally && members && confirmed === null && !expired && members.some(member => !member.answered) &&
      <ReminderCard poll={poll} members={members} linkUrl={linkUrl} />}

    {canViewTally && poll.answers.some(answer => answered(answer) && answer.comment?.trim()) && <section className="m-only card comments-card" aria-label="回答のひとこと">
      <h2>ひとこと</h2>
      <ul className="comment-list">
        {poll.answers.filter(answer => answered(answer) && answer.comment?.trim()).map(answer =>
          <li key={answer.id ?? answer.name}><strong>{answer.name}</strong><span>{answer.comment!.trim()}</span></li>)}
      </ul>
    </section>}

    {canConfirm && <div className="confirm-bar">
      <p className="desk-only best-note"><span>{confirmed !== null ? '確定した候補日' : chosen === best ? '参加できる人が最多' : '選択中の候補日'}</span><strong>{dateLabel((confirmed !== null ? poll.candidates[confirmed]! : candidate).date)} {timeLabel((confirmed !== null ? poll.candidates[confirmed]! : candidate).time)}</strong></p>
      {confirmed !== null ? (onUnconfirm ? <button type="button" className="ghost-btn wide" onClick={unconfirm}>
        <Icon name="close" size={18} className="desk-only" />確定を取り消して再調整
      </button> : <button type="button" className="primary-btn wide" disabled>
        <Icon name="check" size={18} className="desk-only" />確定しました
      </button>) : <button type="button" className="primary-btn wide" onClick={confirm}>
        <Icon name="check" size={18} className="desk-only" /><span className="m-only">{confirmLabel}</span><span className="desk-only">この日程に確定する</span>
      </button>}
    </div>}
  </AppShell>;
}
