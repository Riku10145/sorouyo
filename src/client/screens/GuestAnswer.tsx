import { useEffect, useRef, useState, type SubmitEvent, type ReactNode } from 'react';
import { answerError, dateLabel, dayTone, shortDate, weekday, type Vote } from '../../shared/model';
import { findPoll, groupName, type Poll } from '../../shared/sample';
import { Brand, GroupDot, Icon, InviteHero, VOTE_WORD, VoteMark, VotePicker } from '../design/ui';
import { Envelope } from '../design/art';

function useHashToken() {
  const [token, setToken] = useState(window.location.hash.slice(1).trim());
  useEffect(() => {
    const update = () => setToken(window.location.hash.slice(1).trim());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return token;
}

const deadlineText = (poll: Poll) => `${dateLabel(poll.deadline.date)}${poll.deadline.time}`;

function GuestFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <main className={`guest${wide ? ' guest-wide' : ''}`}>{children}</main>;
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return <GuestFrame><header className="guest-header"><Brand size={28} /></header><h1 className="page-title">{title}</h1>{children}</GuestFrame>;
}

export function GuestAnswer() {
  const token = useHashToken();
  const poll = findPoll(token);
  if (!poll) return <Notice title="招待を開けません">
    <section className="notice-card" role="alert"><Icon name="link" size={32} /><h2>リンクをご確認ください</h2><p>招待リンクが無効です。送ってくれた方に、新しいリンクをお願いしてください。</p></section>
  </Notice>;
  if (poll.closed) return <Notice title="回答は締め切りました">
    <section className="invite-card"><Envelope width={64} height={46} /><h2>{poll.title}</h2><p className="strong">回答締切　{deadlineText(poll)}</p></section>
    <p className="note">回答の追加や変更は、幹事の{poll.host}さんに直接お知らせください。</p>
  </Notice>;
  return <GuestForm key={poll.token} poll={poll} />;
}

function GuestForm({ poll }: { poll: Poll }) {
  const [votes, setVotes] = useState<(Vote | null)[]>(() => poll.candidates.map(() => null));
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [tried, setTried] = useState(false);
  const error = tried ? answerError(votes, name) : '';
  const [sent, setSent] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const done = useRef<HTMLHeadingElement>(null);
  const nameMissing = error !== '' && votes.every(vote => vote !== null);
  useEffect(() => { if (sent) { window.scrollTo({ top: 0 }); done.current?.focus(); } }, [sent]);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (!answerError(votes, name)) { setSent(true); return; }
    const missing = votes.findIndex(vote => vote === null);
    const target = missing >= 0 ? form.current?.querySelectorAll<HTMLElement>('.vote-picker')[missing]?.querySelector<HTMLElement>('[tabindex="0"]') : form.current?.querySelector<HTMLElement>('input[name="name"]');
    target?.focus();
  };

  if (sent) return <GuestFrame>
    <header className="guest-header"><Brand size={28} /></header>
    <h1 className="page-title" ref={done} tabIndex={-1}>回答を送りました</h1>
    <p className="lead">{name.trim()}さんの回答を受け付けました。</p>
    <section className="invite-card"><Envelope width={64} height={46} /><h2>{poll.title}</h2><p className="strong">{groupName(poll.group)}<span aria-hidden="true">・</span>回答の控え</p></section>
    <ul className="receipt">{poll.candidates.map((item, i) => <li key={item.date}><span>{dateLabel(item.date)}<span className="num">{item.time}</span></span><VoteMark vote={votes[i]!} withLabel /></li>)}</ul>
    {comment.trim() && <p className="note">ひとこと：{comment.trim()}</p>}
    <a className="about-row" href="/"><span><strong>そろうよについて</strong><span>家族や友だちと使える共有カレンダーです。</span></span><Icon name="chevronRight" size={18} /></a>
    <div className="guest-footer"><p>締切までは、このリンクから回答を変更できます。</p><button type="button" className="ghost-btn wide" onClick={() => setSent(false)}><Icon name="edit" size={18} />回答を変更する</button></div>
  </GuestFrame>;

  return <GuestFrame wide>
    <div className="guest-split">
      <div className="guest-side">
        <header className="guest-header"><Brand size={28} sub="日程調整" /></header>
        <InviteHero poll={poll} eyebrow={`${poll.host}さんからのお誘い`}>
          <p className="hero-meta"><GroupDot group={poll.group} />{groupName(poll.group)}<span className="m-only"><span aria-hidden="true">・</span>締切 <span className="num">{shortDate(poll.deadline.date)} {poll.deadline.time}</span></span></p>
        </InviteHero>
        <p className="desk-only side-foot"><strong>回答締切　{deadlineText(poll)}</strong><span>アプリ・ログイン不要</span></p>
      </div>
      <form className="guest-form" ref={form} onSubmit={submit} noValidate>
        <div className="vote-head"><h2>候補日</h2><span aria-hidden="true">{Object.values(VOTE_WORD).map(word => <span key={word}>{word}</span>)}</span></div>
        <ul className="vote-rows">{poll.candidates.map((item, i) => <li key={item.date} className="vote-row">
          <span className="cand-date"><span className="num m-only">{shortDate(item.date)}</span><small className={`m-only ${dayTone(item.date) ?? ''}`}>{weekday(item.date)}</small><strong className="desk-only">{dateLabel(item.date)}</strong><span className="cand-time num">{item.time}〜</span></span>
          <VotePicker label={`${dateLabel(item.date)} ${item.time}〜`} describedBy={error ? 'answer-error' : undefined} value={votes[i] ?? null} onChange={vote => setVotes(current => current.map((value, j) => (j === i ? vote : value)))} />
        </li>)}</ul>
        <label className="field"><span>お名前</span><input name="name" value={name} onChange={event => setName(event.target.value)} autoComplete="nickname" maxLength={30} required aria-invalid={nameMissing || undefined} aria-describedby={error ? 'answer-error' : undefined} /></label>
        <label className="field"><span>ひとこと（任意）</span><input value={comment} onChange={event => setComment(event.target.value)} placeholder="みんなに伝えておきたいこと" maxLength={100} /></label>
        {error && <p id="answer-error" className="form-error" role="alert">{error}</p>}
        <button type="submit" className="primary-btn wide">回答を送る</button>
        <p className="form-foot m-only">アプリ・ログイン不要で回答できます</p>
      </form>
    </div>
  </GuestFrame>;
}
