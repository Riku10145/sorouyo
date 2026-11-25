import { useEffect, useRef, useState } from 'react';
import { answered, bestCandidate, dateLabel, shortDate, tally, timeLabel, weekday, dayTone } from '../../shared/model';
import { SAMPLE_ORGANIZER, type Poll } from '../../shared/sample';
import { Icon, InviteHero, VoteMark, notReady, toast, type DisplayGroup } from '../design/ui';
import { AppShell } from './Shell';
import { LoginLink } from './Auth';
import { confirmCandidate, fetchMemberPoll, issueInviteToken, toJst, useMe, type MemberPoll } from '../api';

const guestUrl = (poll: Poll) => `${window.location.origin}/r#${poll.token}`;
const deadlineText = (poll: Poll) => poll.deadline ? `${dateLabel(poll.deadline.date)}${poll.deadline.time}` : 'なし';

const pollDot = (poll: Poll) =>
  <span className={`dot ${poll.group.className ? `g-${poll.group.className}` : ''}`} style={poll.group.color ? { background: poll.group.color } : undefined} aria-hidden="true" />;

function ConfirmComplete({ poll, index }: { poll: Poll; index: number }) {
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
      } catch { return; } // キャンセル時はコピーに倒さない
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
    <div className="calendar-added" role="status">
      <Icon name="check" size={20} />
      <p><strong>{poll.group.name}のカレンダーに追加しました</strong><span>参加メンバーと同じ予定を確認できます。</span></p>
    </div>
    <button type="button" className="ghost-btn wide" onClick={share}><Icon name="share" size={18} />決まった日程を共有</button>
    <a className="primary-btn wide confirm-calendar-link" href={`/?date=${candidate.date}`}><Icon name="calendar" size={18} />カレンダーで見る</a>
  </section>;
}

/** /polls/<id> を実データで開く。ログインが必要な場合は設定画面への導線を出す。 */
export function RemotePollStatus({ id, selectedDate }: { id: string; selectedDate: string }) {
  const me = useMe();
  const [result, setResult] = useState<{ poll?: MemberPoll; status: number } | 'loading'>('loading');
  useEffect(() => {
    let active = true;
    fetchMemberPoll(id).then(found => { if (active) setResult(found); })
      .catch(() => { if (active) setResult({ status: 0 }); });
    return () => { active = false; };
  }, [id]);
  // hooks は早期returnより前に置く。Promise を保持して同時コピーの重複発行も防ぐ
  const issuedLink = useRef<Promise<string> | null>(null);
  if (result === 'loading') return null;
  if (!result.poll) {
    const login = result.status === 401;
    return <AppShell active="polls" selectedDate={selectedDate} groups={[]} subpage>
      <div className="m-only m-back"><a className="text-btn" href="/polls"><Icon name="chevronLeft" size={20} />日程調整</a></div>
      <section className="notice-card" role="alert" style={{ margin: '24px 16px' }}>
        <Icon name="link" size={32} />
        <h2>{login ? 'ログインが必要です' : '調整を開けません'}</h2>
        <p>{login ? 'この日程調整はログインした主催者・メンバーだけが見られます。' : '権限がないか、削除された可能性があります。'}</p>
        {login && <LoginLink next={`/polls/${id}`} className="soft-btn"><Icon name="settings" size={18} />ログイン</LoginLink>}
      </section>
    </AppShell>;
  }
  const remote = result.poll;
  const expired = remote.status === 'open' && !!remote.deadlineAt && remote.deadlineAt <= new Date().toISOString();
  const confirmedIndex = remote.confirmedCandidateId
    ? remote.candidates.findIndex(c => c.id === remote.confirmedCandidateId) : null;
  const poll: Poll = {
    id: remote.id,
    token: '',
    title: remote.title,
    group: { name: remote.group.name, color: remote.group.color ?? undefined },
    host: remote.hostName ?? '幹事',
    deadline: remote.deadlineAt ? toJst(remote.deadlineAt) : null,
    closed: remote.status === 'confirmed',
    candidates: remote.candidates.map(c => ({ id: c.id, date: c.date, time: c.startTime ?? '' })),
    answers: remote.answers.map(a => ({
      id: a.id,
      name: a.name,
      comment: a.comment ?? undefined,
      own: a.own,
      votes: remote.candidates.map(c => a.votes[c.id] ?? null),
    })),
    confirmedIndex: confirmedIndex !== null && confirmedIndex >= 0 ? confirmedIndex : null,
  };
  const link = async () => {
    issuedLink.current ??= issueInviteToken(remote.id).then(token =>
      token ? `${window.location.origin}/r#${token}` : Promise.reject(new Error('no token')));
    try {
      return await issuedLink.current;
    } catch {
      issuedLink.current = null; // 失敗は保持しない。次のコピーで発行をやり直せるように
      return '';
    }
  };
  const viewerName = me ? [me.user.lastName, me.user.firstName].filter(Boolean).join(' ') || me.user.email : undefined;
  return <PollStatus poll={poll} selectedDate={selectedDate} expired={expired}
    canConfirm={me?.user.id === remote.creatorId} // 確定は主催者のみ（バックエンドも403で保護）
    viewerName={viewerName}
    onConfirm={index => confirmCandidate(remote.id, remote.candidates[index]!.id)}
    onCopyLink={link}
    onAnswerLink={async () => { const url = await link(); window.location.href = url; }} />;
}

export function PollStatus({ poll, selectedDate, expired = false, canConfirm = true, viewerName, onConfirm, onCopyLink, onAnswerLink }: {
  poll: Poll; selectedDate: string; expired?: boolean;
  /** 確定権限がある操作者か（主催者のみ。メンバーには確定UIを出さない） */
  canConfirm?: boolean;
  /** 回答前の自分を一覧に出すためのログイン中の表示名 */
  viewerName?: string;
  onConfirm?: (index: number) => Promise<boolean>;
  onCopyLink?: () => Promise<string>;
  onAnswerLink?: () => void;
}) {
  const best = bestCandidate(poll);
  const [chosen, setChosen] = useState(best);
  const [confirmed, setConfirmed] = useState<number | null>(poll.confirmedIndex ?? null);
  const [completion, setCompletion] = useState<{ pollKey: string; index: number } | null>(null);
  const chosenCard = useRef<HTMLElement>(null);
  const picked = useRef(false);
  useEffect(() => { if (picked.current) { picked.current = false; chosenCard.current?.focus(); } }, [chosen]);
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
  const linkUrl = async () => onCopyLink ? await onCopyLink() : guestUrl(poll);
  const copy = async () => {
    // iOS Safari はタップのジェスチャーが切れると書き込みを拒否するため、
    // リンク取得を待つ版は ClipboardItem に Promise を渡して先に書き込みを開始する
    if (onCopyLink && typeof ClipboardItem !== 'undefined') {
      try {
        const item = new ClipboardItem({
          'text/plain': linkUrl().then(url => {
            if (!url) throw new Error('no link');
            return new Blob([url], { type: 'text/plain' });
          }),
        });
        await navigator.clipboard.write([item]);
        toast('回答リンクをコピーしました');
        return;
      } catch { /* フォールバックに回す */ }
    }
    const url = await linkUrl();
    if (!url) { toast('回答リンクを作れませんでした'); return; }
    try { await navigator.clipboard.writeText(url); toast('回答リンクをコピーしました'); }
    catch { toast(`回答リンク：${url}`); }
  };
  const confirming = useRef(false);
  const confirm = async () => {
    if (confirmed !== null || confirming.current) return; // 確定後・確定処理中の再確定はさせない
    confirming.current = true;
    let done = true;
    try { done = onConfirm ? await onConfirm(chosen) : true; }
    catch { done = false; } // ネットワークエラー等でも失敗トーストに倒す
    finally { confirming.current = false; }
    if (done) {
      setConfirmed(chosen);
      setCompletion({ pollKey, index: chosen });
    } else toast('確定できませんでした。すでに別の日に確定している可能性があります');
  };
  const expiredBanner = expired && confirmed === null && <p className="expired-note" role="status">
    <Icon name="clock" size={18} />{canConfirm ? '回答締切を過ぎました。回答は締め切られていますが、候補を選んで確定できます。' : '回答締切を過ぎました。回答は締め切られています。'}
  </p>;
  const progressText = `${displayAnswers.length}人中${respondents}人が回答`;
  const progress = <p className="progress"><span className="bars" aria-hidden="true">{displayAnswers.map((_, i) => <i key={i} className={i < respondents ? 'on' : ''} />)}</span>{progressText}</p>;
  const deadline = deadlineText(poll);

  const group: DisplayGroup = { id: poll.token || poll.title, name: poll.group.name, color: poll.group.color ?? null, className: poll.group.className };
  if (completion?.pollKey === pollKey) {
    // 完了画面はこの調整を確定した表示中だけに出す。再訪・別の調整では状態が残らない
    return <AppShell active="polls" selectedDate={selectedDate} groups={[group]} subpage>
      <div className="m-only m-back">
        <a className="text-btn" href="/polls"><Icon name="chevronLeft" size={20} />日程調整</a>
      </div>
      <ConfirmComplete poll={poll} index={completion.index} />
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
        <button type="button" className="ghost-btn" onClick={() => notReady('候補日の追加')}><Icon name="plus" size={18} />候補日を追加</button>
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
        <button type="button" className="text-btn" onClick={() => notReady('候補日の追加')}><Icon name="plus" size={18} />候補日を追加</button>
      </div>
      {poll.candidates.map((item, index) => ({ item, index })).sort((a, b) => Number(b.index === chosen) - Number(a.index === chosen)).map(({ item, index }) => {
        const count = tally(poll, index);
        const label = `${dateLabel(item.date)} ${timeLabel(item.time)}`;
        return index === chosen
          ? <article key={item.id ?? item.date} ref={chosenCard} tabIndex={-1} className="cand-card" aria-label={`${label}（選択中）`}>
            <div className="cand-top">
              <p className="cand-date"><span className="num">{shortDate(item.date)}</span><small className={dayTone(item.date)}>{weekday(item.date)}</small><span className="cand-time num">{timeLabel(item.time)}</span></p>
              <div className="cand-flags">{index === best && <span>参加できる人が最多</span>}{index === confirmed && <span className="chip-soft">確定</span>}<span className="chip-selected"><Icon name="check" size={14} />選択中</span></div>
            </div>
            <ul className="member-marks">
              {you && <li>{answered(you) ? <span className={`mark-circle v-${you.votes[index] ?? 'none'}`}><VoteMark vote={you.votes[index] ?? null} /></span> : <span className="badge-pending">未回答</span>}<strong>あなた</strong></li>}
              {others.map(answer => <li key={answer.name}><span className={`mark-circle v-${answer.votes[index] ?? 'none'}`}><VoteMark vote={answer.votes[index] ?? null} /></span><span>{answer.name}</span></li>)}
            </ul>
          </article>
          : <button type="button" key={item.id ?? item.date} className="cand-row" onClick={() => choose(index)} aria-label={`${label}、参加${count.yes}、未定${count.maybe}、欠席${count.no}。この候補日を選ぶ`}>
            <span className="cand-date"><span className="num">{shortDate(item.date)}</span><small className={dayTone(item.date)}>{weekday(item.date)}</small><span className="cand-time num">{timeLabel(item.time)}</span></span>
            {index === confirmed && <span className="chip-soft">確定</span>}
            <span className="counts"><span>参加<b>{count.yes}</b></span><span>未定<b className="maybe">{count.maybe}</b></span><span>欠席<b className="no">{count.no}</b></span></span>
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
          <th scope="row">{answer.name}{answer === you && '（あなた）'}</th>
          {poll.candidates.map((item, index) => <td key={item.id ?? item.date}><VoteMark vote={answer.votes[index] ?? null} withLabel /></td>)}
        </tr>)}</tbody>
      </table>
    </section>

    {canConfirm && <div className="confirm-bar">
      <p className="desk-only best-note"><span>{confirmed !== null ? '確定した候補日' : chosen === best ? '参加できる人が最多' : '選択中の候補日'}</span><strong>{dateLabel((confirmed !== null ? poll.candidates[confirmed]! : candidate).date)} {timeLabel((confirmed !== null ? poll.candidates[confirmed]! : candidate).time)}</strong></p>
      <button type="button" className="primary-btn wide" disabled={confirmed !== null} onClick={confirm}>
        <Icon name="check" size={18} className="desk-only" />{confirmed !== null ? '確定しました' : <><span className="m-only">{confirmLabel}</span><span className="desk-only">この日程に確定する</span></>}
      </button>
    </div>}
  </AppShell>;
}
