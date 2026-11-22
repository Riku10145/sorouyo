import { useEffect, useRef, useState } from 'react';
import { answered, bestCandidate, dateLabel, shortDate, tally, weekday, dayTone } from '../../shared/model';
import { SAMPLE_ORGANIZER, type Poll } from '../../shared/sample';
import { Icon, InviteHero, VoteMark, notReady, toast, type DisplayGroup } from '../design/ui';
import { AppShell } from './Shell';
import { confirmCandidate, fetchMemberPoll, issueInviteToken, toJst, type MemberPoll } from '../api';

const guestUrl = (poll: Poll) => `${window.location.origin}/r#${poll.token}`;

const pollDot = (poll: Poll) =>
  <span className={`dot ${poll.group.className ? `g-${poll.group.className}` : ''}`} style={poll.group.color ? { background: poll.group.color } : undefined} aria-hidden="true" />;

/** /polls/<id> を実データで開く。ログインが必要な場合は設定画面への導線を出す。 */
export function RemotePollStatus({ id, selectedDate }: { id: string; selectedDate: string }) {
  const [result, setResult] = useState<{ poll?: MemberPoll; status: number } | 'loading'>('loading');
  useEffect(() => {
    let active = true;
    fetchMemberPoll(id).then(found => { if (active) setResult(found); })
      .catch(() => { if (active) setResult({ status: 0 }); });
    return () => { active = false; };
  }, [id]);
  if (result === 'loading') return null;
  if (!result.poll) {
    const login = result.status === 401;
    return <AppShell active="polls" selectedDate={selectedDate} groups={[]} subpage>
      <div className="m-only m-back"><a className="text-btn" href="/"><Icon name="chevronLeft" size={20} />日程調整</a></div>
      <section className="notice-card" role="alert" style={{ margin: '24px 16px' }}>
        <Icon name="link" size={32} />
        <h2>{login ? 'ログインが必要です' : '調整を開けません'}</h2>
        <p>{login ? 'この日程調整はログインした主催者・メンバーだけが見られます。' : '権限がないか、削除された可能性があります。'}</p>
        {login && <a className="soft-btn" href="/settings"><Icon name="settings" size={18} />設定からログイン</a>}
      </section>
    </AppShell>;
  }
  const remote = result.poll;
  const confirmedIndex = remote.confirmedCandidateId
    ? remote.candidates.findIndex(c => c.id === remote.confirmedCandidateId) : null;
  const poll: Poll = {
    token: '',
    title: remote.title,
    group: { name: remote.group.name, color: remote.group.color ?? undefined },
    host: remote.hostName ?? '幹事',
    deadline: remote.deadlineAt ? toJst(remote.deadlineAt) : { date: '1970-01-01', time: '00:00' },
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
    const token = await issueInviteToken(remote.id);
    return token ? `${window.location.origin}/r#${token}` : '';
  };
  return <PollStatus poll={poll} selectedDate={selectedDate}
    onConfirm={index => confirmCandidate(remote.id, remote.candidates[index]!.id)}
    onCopyLink={link}
    onAnswerLink={async () => { const url = await link(); window.location.href = url; }} />;
}

export function PollStatus({ poll, selectedDate, onConfirm, onCopyLink, onAnswerLink }: {
  poll: Poll; selectedDate: string;
  onConfirm?: (index: number) => Promise<boolean>;
  onCopyLink?: () => Promise<string>;
  onAnswerLink?: () => void;
}) {
  const best = bestCandidate(poll);
  const [chosen, setChosen] = useState(best);
  const [confirmed, setConfirmed] = useState<number | null>(poll.confirmedIndex ?? null);
  const chosenCard = useRef<HTMLElement>(null);
  const picked = useRef(false);
  useEffect(() => { if (picked.current) { picked.current = false; chosenCard.current?.focus(); } }, [chosen]);
  const choose = (index: number) => { picked.current = true; setChosen(index); };
  const you = poll.answers.find(answer => answer.own ?? answer.name === SAMPLE_ORGANIZER);
  const others = poll.answers.filter(answer => answer !== you);
  const respondents = poll.answers.filter(answered).length;
  const candidate = poll.candidates[chosen]!;
  const confirmLabel = `${dateLabel(candidate.date).replace('（', '(').replace('）', ')')}に確定する`;
  const linkUrl = async () => onCopyLink ? await onCopyLink() : guestUrl(poll);
  const copy = async () => {
    const url = await linkUrl();
    if (!url) { toast('回答リンクを作れませんでした'); return; }
    try { await navigator.clipboard.writeText(url); toast('回答リンクをコピーしました'); }
    catch { toast(`回答リンク：${url}`); }
  };
  const confirm = async () => {
    if (onConfirm) { if (await onConfirm(chosen)) setConfirmed(chosen); }
    else setConfirmed(chosen);
  };
  const confirmedBanner = confirmed !== null && <p className="confirmed" role="status">
    <Icon name="check" size={18} />{dateLabel(poll.candidates[confirmed]!.date)} {poll.candidates[confirmed]!.time}〜に決まりました。
  </p>;
  const progress = <p className="progress"><span className="bars" aria-hidden="true">{poll.answers.map((_, i) => <i key={i} className={i < respondents ? 'on' : ''} />)}</span>{poll.answers.length}人中{respondents}人が回答</p>;

  const group: DisplayGroup = { id: poll.token || poll.title, name: poll.group.name, color: poll.group.color ?? null, className: poll.group.className };
  return <AppShell active="polls" selectedDate={selectedDate} groups={[group]} subpage>
    <div className="m-only m-back"><a className="text-btn" href="/"><Icon name="chevronLeft" size={20} />日程調整</a></div>
    <div className="desk-only poll-toolbar">
      <p className="page-label">日程調整</p>
      <div className="toolbar-actions">
        <button type="button" className="ghost-btn" onClick={() => notReady('候補日の追加')}><Icon name="plus" size={18} />候補日を追加</button>
        <button type="button" className="ghost-btn" onClick={copy}><Icon name="copy" size={18} />リンクをコピー</button>
        <button type="button" className="soft-btn" onClick={() => onAnswerLink ? onAnswerLink() : window.location.href = `/r#${poll.token}`}><Icon name="edit" size={18} />自分の回答を入力</button>
      </div>
    </div>
    <InviteHero poll={poll} eyebrow={`${poll.group.name}の日程調整`}>
      <span className="m-only">{progress}</span>
      <p className="desk-only hero-meta">{poll.answers.length}人中{respondents}人が回答<span aria-hidden="true">・</span>回答締切 {dateLabel(poll.deadline.date)}{poll.deadline.time}</p>
    </InviteHero>
    {confirmedBanner}

    <section className="m-only poll-list" aria-labelledby="poll-list-heading">
      <div className="section-head">
        <h2 id="poll-list-heading">候補日の回答</h2>
        <button type="button" className="text-btn" onClick={() => notReady('候補日の追加')}><Icon name="plus" size={18} />候補日を追加</button>
      </div>
      {poll.candidates.map((item, index) => ({ item, index })).sort((a, b) => Number(b.index === chosen) - Number(a.index === chosen)).map(({ item, index }) => {
        const count = tally(poll, index);
        const label = `${dateLabel(item.date)} ${item.time}〜`;
        return index === chosen
          ? <article key={item.id ?? item.date} ref={chosenCard} tabIndex={-1} className="cand-card" aria-label={`${label}（選択中）`}>
            <div className="cand-top">
              <p className="cand-date"><span className="num">{shortDate(item.date)}</span><small className={dayTone(item.date)}>{weekday(item.date)}</small><span className="cand-time num">{item.time}〜</span></p>
              <div className="cand-flags">{index === best && <span>参加できる人が最多</span>}<span className="chip-selected"><Icon name="check" size={14} />選択中</span></div>
            </div>
            <ul className="member-marks">
              {you && <li>{answered(you) ? <span className={`mark-circle v-${you.votes[index] ?? 'none'}`}><VoteMark vote={you.votes[index] ?? null} /></span> : <span className="badge-pending">未回答</span>}<strong>あなた</strong></li>}
              {others.map(answer => <li key={answer.name}><span className={`mark-circle v-${answer.votes[index] ?? 'none'}`}><VoteMark vote={answer.votes[index] ?? null} /></span><span>{answer.name}</span></li>)}
            </ul>
          </article>
          : <button type="button" key={item.id ?? item.date} className="cand-row" onClick={() => choose(index)} aria-label={`${label}、参加${count.yes}、未定${count.maybe}、欠席${count.no}。この候補日を選ぶ`}>
            <span className="cand-date"><span className="num">{shortDate(item.date)}</span><small className={dayTone(item.date)}>{weekday(item.date)}</small><span className="cand-time num">{item.time}〜</span></span>
            <span className="counts"><span>参加<b>{count.yes}</b></span><span>未定<b className="maybe">{count.maybe}</b></span><span>欠席<b className="no">{count.no}</b></span></span>
            <Icon name="chevronRight" size={18} />
          </button>;
      })}
      {(!you || !answered(you)) && <div className="you-row"><p>あなたはまだ未回答です</p><button type="button" className="soft-btn" onClick={() => onAnswerLink ? onAnswerLink() : window.location.href = `/r#${poll.token}`}><Icon name="edit" size={18} />回答する</button></div>}
    </section>

    <section className="desk-only matrix-card" aria-label="候補日ごとの回答">
      <table className="matrix">
        <thead><tr><th scope="col">メンバー</th>{poll.candidates.map((item, index) => <th scope="col" key={item.id ?? item.date}>
          <button type="button" className="matrix-date" aria-pressed={index === chosen} onClick={() => setChosen(index)}>
            <strong>{dateLabel(item.date)}</strong><span className="num">{item.time}〜</span>{index === chosen && <span className="chip-soft">選択中</span>}
          </button></th>)}</tr></thead>
        <tbody>{poll.answers.map(answer => <tr key={answer.id ?? answer.name} className={answer === you ? 'you' : ''}>
          <th scope="row">{answer.name}{answer === you && '（あなた）'}</th>
          {poll.candidates.map((item, index) => <td key={item.id ?? item.date}><VoteMark vote={answer.votes[index] ?? null} withLabel /></td>)}
        </tr>)}</tbody>
      </table>
    </section>

    <div className="confirm-bar">
      <p className="desk-only best-note"><span>{chosen === best ? '参加できる人が最多' : '選択中の候補日'}</span><strong>{dateLabel(candidate.date)}{candidate.time}〜</strong></p>
      <button type="button" className="primary-btn wide" disabled={confirmed === chosen} onClick={confirm}>
        <Icon name="check" size={18} className="desk-only" />{confirmed === chosen ? '確定しました' : <><span className="m-only">{confirmLabel}</span><span className="desk-only">この日程に確定する</span></>}
      </button>
    </div>
  </AppShell>;
}
