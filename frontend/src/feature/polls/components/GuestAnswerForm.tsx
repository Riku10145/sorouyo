import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import type { Vote } from '../../../../../shared/schema';
import { Brand } from '../../../components/Brand';
import { GuestFrame } from '../../../components/GuestFrame';
import { Icon } from '../../../components/Icon';
import { Envelope } from '../../../design/art';
import { dateLabel, dayTone, shortDate, timeLabel, weekday } from '../../../lib/date';
import { recordUsageStartClick, type AnswerResult } from '../api/invite';
import { type Poll, deadlineText } from '../lib/poll';
import { VOTES, answerError } from '../lib/votes';
import { ClosedNotice } from './GuestNotices';
import { InviteHero } from './InviteHero';
import { VoteMark, VotePicker } from './Vote';

export function GuestAnswerForm({ poll, initial, onSubmit, usageStartToken }: {
  poll: Poll;
  initial?: { name: string; comment: string; votes: (Vote | null)[] };
  onSubmit?: (votes: (Vote | null)[], name: string, comment: string) => Promise<AnswerResult>;
  usageStartToken?: string;
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
      <a className="primary-btn wide" href="/groups?create=1" onClick={() => usageStartToken && recordUsageStartClick(usageStartToken)}><Icon name="plus" size={18} />自分のグループを作る</a>
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
        <div className="vote-head"><h2 ref={candidates} tabIndex={-1}>候補日</h2><span aria-hidden="true">{VOTES.map(vote => <span key={vote.value}>{vote.label}</span>)}</span></div>
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

const pollDot = (poll: Poll) =>
  <span className={`dot ${poll.group.className ? `g-${poll.group.className}` : ''}`} style={poll.group.color ? { background: poll.group.color } : undefined} aria-hidden="true" />;
