import { useEffect, useRef, useState, type SubmitEvent, type ReactNode } from 'react';
import { answerError, dateLabel, dayTone, shortDate, timeLabel, weekday, type Vote } from '../../shared/model';
import { findPoll, type Poll } from '../../shared/sample';
import { Brand, Icon, InviteHero, VOTE_WORD, VoteMark, VotePicker } from '../design/ui';
import { Envelope } from '../design/art';
import { fetchInvite, submitAnswer, toJst, type AnswerResult, type InvitePoll } from '../api';

export function useHashToken() {
  const [token, setToken] = useState(window.location.hash.slice(1).trim());
  useEffect(() => {
    const update = () => setToken(window.location.hash.slice(1).trim());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return token;
}

const deadlineText = (poll: Poll) => poll.deadline ? `${dateLabel(poll.deadline.date)}${poll.deadline.time}` : 'なし';

export function GuestFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <main className={`guest${wide ? ' guest-wide' : ''}`}>{children}</main>;
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return <GuestFrame><header className="guest-header"><Brand size={28} /></header><h1 className="page-title">{title}</h1>{children}</GuestFrame>;
}

const pollDot = (poll: Poll) =>
  <span className={`dot ${poll.group.className ? `g-${poll.group.className}` : ''}`} style={poll.group.color ? { background: poll.group.color } : undefined} aria-hidden="true" />;

const InvalidNotice = () => <Notice title="招待を開けません">
  <section className="notice-card" role="alert"><Icon name="link" size={32} /><h2>リンクをご確認ください</h2><p>招待リンクが無効です。送ってくれた方に、新しいリンクをお願いしてください。</p></section>
</Notice>;

const InviteLoadError = ({ retry }: { retry: () => void }) => <Notice title="招待を読み込めませんでした">
  <section className="notice-card">
    <Icon name="alert" size={32} />
    <p role="alert">時間をおいて、同じリンクでお試しください。</p>
    <button type="button" className="primary-btn" onClick={retry}>もう一度試す</button>
  </section>
</Notice>;

const ClosedNotice = ({ poll }: { poll: Poll }) => <Notice title="回答は締め切りました">
  <section className="invite-card"><Envelope width={64} height={46} /><h2>{poll.title}</h2><p className="strong">回答締切　{deadlineText(poll)}</p></section>
  <p className="note">回答の追加や変更は、幹事の{poll.host}さんに直接お知らせください。</p>
</Notice>;

const ConfirmedNotice = ({ poll, decided }: { poll: Poll; decided: { date: string; time: string } }) => <Notice title="日程が決まりました">
  <section className="invite-card"><Envelope width={64} height={46} /><h2>{poll.title}</h2><p className="strong">{dateLabel(decided.date)} {timeLabel(decided.time)}に決まりました</p></section>
  <p className="note">回答の追加や変更は、幹事の{poll.host}さんに直接お知らせください。</p>
</Notice>;

export function GuestAnswer() {
  const token = useHashToken();
  const sample = findPoll(token);
  if (sample) {
    if (sample.closed) return <ClosedNotice poll={sample} />;
    return <GuestForm key={sample.token} poll={sample} />;
  }
  return <RemoteGuest key={token} token={token} />;
}

/** 実データの回答リンク（/r#<token>）。トークンをAPIに渡して対象の調整だけを取得する。 */
function RemoteGuest({ token }: { token: string }) {
  const [result, setResult] = useState<InvitePoll | 'loading' | 'invalid' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!token) { setResult('invalid'); return; }
    let active = true;
    fetchInvite(token).then(found => { if (active) setResult(found.status === 'ok' ? found.poll : found.status); })
      .catch(() => { if (active) setResult('error'); });
    return () => { active = false; };
  }, [token, attempt]);
  if (result === 'loading') return <GuestFrame><header className="guest-header"><Brand size={28} /></header></GuestFrame>;
  if (result === 'invalid') return <InvalidNotice />;
  if (result === 'error') return <InviteLoadError retry={() => {
    setResult('loading');
    setAttempt(current => current + 1);
  }} />;
  const poll: Poll = {
    token,
    title: result.title,
    group: { name: result.group.name, color: result.group.color ?? undefined },
    host: result.host ?? '幹事',
    deadline: result.deadlineAt ? toJst(result.deadlineAt) : null,
    closed: !result.accepting,
    candidates: result.candidates.map(c => ({ id: c.id, date: c.date, time: c.startTime ?? '' })),
    answers: [],
  };
  if (!result.accepting) {
    return result.status === 'confirmed' && result.confirmed
      ? <ConfirmedNotice poll={poll} decided={{ date: result.confirmed.date, time: result.confirmed.startTime ?? '' }} />
      : <ClosedNotice poll={poll} />;
  }
  const initial = result.ownAnswer ? {
    name: result.ownAnswer.name,
    comment: result.ownAnswer.comment ?? '',
    votes: result.candidates.map(c => result.ownAnswer!.votes[c.id] ?? null),
  } : undefined;
  const send = async (votes: (Vote | null)[], name: string, comment: string): Promise<AnswerResult> =>
    submitAnswer(token, name, comment, votes.flatMap((vote, i) => {
      const candidateId = result.candidates[i]?.id;
      return vote && candidateId ? [{ candidateId, value: vote }] : [];
    }));
  return <GuestForm key={result.id} poll={poll} initial={initial} onSubmit={send} />;
}

function GuestForm({ poll, initial, onSubmit }: {
  poll: Poll;
  initial?: { name: string; comment: string; votes: (Vote | null)[] };
  onSubmit?: (votes: (Vote | null)[], name: string, comment: string) => Promise<AnswerResult>;
}) {
  const [votes, setVotes] = useState<(Vote | null)[]>(() => initial?.votes ?? poll.candidates.map(() => null));
  const [name, setName] = useState(initial?.name ?? '');
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [tried, setTried] = useState(false);
  const error = tried ? answerError(votes, name) : '';
  const [view, setView] = useState<'answering' | 'sent' | 'editing'>('answering');
  const [sending, setSending] = useState(false);
  const [closed, setClosed] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const done = useRef<HTMLHeadingElement>(null);
  const candidates = useRef<HTMLHeadingElement>(null);
  const nameMissing = error !== '' && votes.every(vote => vote !== null);
  useEffect(() => {
    if (view === 'sent') { window.scrollTo({ top: 0 }); done.current?.focus(); }
    else if (view === 'editing') candidates.current?.focus();
  }, [view]);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (!answerError(votes, name)) {
      setSending(true);
      setSendError(null);
      setDenied(false);
      setRateLimited(false);
      (onSubmit ?? (() => Promise.resolve<AnswerResult>('ok')))(votes, name.trim(), comment.trim())
        .then(result => {
          setSending(false);
          if (result === 'ok') setView('sent');
          else if (result === 'closed') setClosed(true);
          else if (result === 'forbidden') setDenied(true);
          else if (result === 'rate_limited') setRateLimited(true);
          else if (result === 'conflict') setSendError('候補日が主催者によって変更されました。ページを読み直して、最新の候補日に回答し直してください。');
          else setSendError('送信に失敗しました。時間をおいて再度お試しください。');
        }).catch(() => { setSending(false); setSendError('送信に失敗しました。時間をおいて再度お試しください。'); });
      return;
    }
    const missing = votes.findIndex(vote => vote === null);
    const target = missing >= 0 ? form.current?.querySelectorAll<HTMLElement>('.vote-picker')[missing]?.querySelector<HTMLElement>('[tabindex="0"]') : form.current?.querySelector<HTMLElement>('input[name="name"]');
    target?.focus();
  };

  if (closed) return <ClosedNotice poll={poll} />;
  if (view === 'sent') return <GuestFrame>
    <header className="guest-header"><Brand size={28} /></header>
    <h1 className="page-title" ref={done} tabIndex={-1}>回答を送りました</h1>
    <p className="lead receipt-text">{name.trim()}さんの回答を受け付けました。</p>
    <section className="invite-card"><Envelope width={64} height={46} /><h2>{poll.title}</h2><p className="strong">{poll.group.name}<span aria-hidden="true">・</span>回答の控え</p></section>
    <ul className="receipt">{poll.candidates.map((item, i) => <li key={item.id ?? item.date}><span>{dateLabel(item.date)}<span className="num">{item.time}</span></span><VoteMark vote={votes[i]!} withLabel /></li>)}</ul>
    {comment.trim() && <p className="note receipt-text">ひとこと：{comment.trim()}</p>}
    <section className="invite-card guest-start">
      <h2>次はあなたが主催しませんか</h2>
      <p className="note">そろうよでは、家族や友だちとの予定を○△×で集められます。あなた自身のグループを作って、日程調整を始められます。</p>
      <a className="primary-btn wide" href="/groups"><Icon name="plus" size={18} />自分のグループを作る</a>
    </section>
    <a className="about-row" href="/"><span><strong>そろうよについて</strong><span>家族や友だちと使える共有カレンダーです。</span></span><Icon name="chevronRight" size={18} /></a>
    <div className="guest-footer"><p>締切までは、このリンクから回答を変更できます。</p><button type="button" className="ghost-btn wide" onClick={() => setView('editing')}><Icon name="edit" size={18} />回答を変更する</button></div>
  </GuestFrame>;

  return <GuestFrame wide>
    <div className="guest-split">
      <div className="guest-side">
        <header className="guest-header"><Brand size={28} sub="日程調整" /></header>
        <InviteHero poll={poll} eyebrow={`${poll.host}さんからのお誘い`}>
          <p className="hero-meta">{pollDot(poll)}{poll.group.name}<span className="m-only"><span aria-hidden="true">・</span>{poll.deadline ? <>締切 <span className="num">{shortDate(poll.deadline.date)} {poll.deadline.time}</span></> : '締切なし'}</span></p>
        </InviteHero>
        <p className="desk-only side-foot"><strong>回答締切　{deadlineText(poll)}</strong><span>アプリ・ログイン不要</span></p>
      </div>
      <form className="guest-form" ref={form} onSubmit={submit} noValidate>
        <div className="vote-head"><h2 ref={candidates} tabIndex={-1}>候補日</h2><span aria-hidden="true">{Object.values(VOTE_WORD).map(word => <span key={word}>{word}</span>)}</span></div>
        <ul className="vote-rows">{poll.candidates.map((item, i) => <li key={item.id ?? item.date} className="vote-row">
          <span className="cand-date"><span className="num m-only">{shortDate(item.date)}</span><small className={`m-only ${dayTone(item.date) ?? ''}`}>{weekday(item.date)}</small><strong className="desk-only">{dateLabel(item.date)}</strong><span className="cand-time num">{timeLabel(item.time)}</span></span>
          <VotePicker label={`${dateLabel(item.date)} ${timeLabel(item.time)}`} describedBy={error ? 'answer-error' : undefined} value={votes[i] ?? null} onChange={vote => setVotes(current => current.map((value, j) => (j === i ? vote : value)))} />
        </li>)}</ul>
        <label className="field"><span>お名前</span><input name="name" value={name} onChange={event => setName(event.target.value)} autoComplete="nickname" maxLength={30} required aria-invalid={nameMissing || undefined} aria-describedby={error ? 'answer-error' : undefined} /></label>
        <label className="field"><span>ひとこと（任意）</span><input value={comment} onChange={event => setComment(event.target.value)} placeholder="みんなに伝えておきたいこと" maxLength={100} /></label>
        {error && <p id="answer-error" className="form-error" role="alert">{error}</p>}
        {sendError && <p className="form-error" role="alert">{sendError}</p>}
        {denied && <p className="form-error" role="alert">ログイン中のアカウントではこの調整に回答できません。グループのメンバーになるか、ログアウトしてからお試しください。</p>}
        {rateLimited && <p className="form-error" role="alert">少し時間をおいてもう一度お試しください。</p>}
        <button type="submit" className="primary-btn wide" disabled={sending}>{sending ? '送信中…' : '回答を送る'}</button>
        <p className="form-foot m-only">アプリ・ログイン不要で回答できます</p>
      </form>
    </div>
  </GuestFrame>;
}
