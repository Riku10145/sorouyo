import { useState } from 'react';
import { answered, bestCandidate, dateLabel, shortDate, tally, weekday, dayTone } from '../../shared/model';
import { SAMPLE_ORGANIZER, groupName, type Poll } from '../../shared/sample';
import { Icon, InviteHero, VoteMark, notReady, toast } from '../design/ui';
import { AppShell } from './Shell';

const guestUrl = (poll: Poll) => `${window.location.origin}/r#${poll.token}`;

export function PollStatus({ poll, selectedDate }: { poll: Poll; selectedDate: string }) {
  const best = bestCandidate(poll);
  const [chosen, setChosen] = useState(best);
  const [confirmed, setConfirmed] = useState<number | null>(null);
  const you = poll.answers.find(answer => answer.name === SAMPLE_ORGANIZER);
  const others = poll.answers.filter(answer => answer !== you);
  const respondents = poll.answers.filter(answered).length;
  const candidate = poll.candidates[chosen]!;
  const confirmLabel = `${dateLabel(candidate.date).replace('（', '(').replace('）', ')')}に確定する`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(guestUrl(poll)); toast('回答リンクをコピーしました'); }
    catch { toast(`回答リンク：${guestUrl(poll)}`); }
  };
  const confirmedBanner = confirmed !== null && <p className="confirmed" role="status">
    <Icon name="check" size={18} />{dateLabel(poll.candidates[confirmed]!.date)} {poll.candidates[confirmed]!.time}〜に決まりました。
  </p>;
  const progress = <p className="progress"><span className="bars" aria-hidden="true">{poll.answers.map((_, i) => <i key={i} className={i < respondents ? 'on' : ''} />)}</span>{poll.answers.length}人中{respondents}人が回答</p>;

  return <AppShell active="polls" selectedDate={selectedDate} subpage>
    <div className="m-only m-back"><a className="text-btn" href="/"><Icon name="chevronLeft" size={20} />日程調整</a></div>
    <div className="desk-only poll-toolbar">
      <p className="page-label">日程調整</p>
      <div className="toolbar-actions">
        <button type="button" className="ghost-btn" onClick={() => notReady('候補日の追加')}><Icon name="plus" size={18} />候補日を追加</button>
        <button type="button" className="ghost-btn" onClick={copy}><Icon name="copy" size={18} />リンクをコピー</button>
        <a className="soft-btn" href={`/r#${poll.token}`}><Icon name="edit" size={18} />自分の回答を入力</a>
      </div>
    </div>
    <InviteHero poll={poll} eyebrow={`${groupName(poll.group)}の日程調整`}>
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
          ? <article key={item.date} className="cand-card" aria-label={`${label}（選択中）`}>
            <div className="cand-top">
              <p className="cand-date"><span className="num">{shortDate(item.date)}</span><small className={dayTone(item.date)}>{weekday(item.date)}</small><span className="cand-time num">{item.time}〜</span></p>
              <div className="cand-flags">{index === best && <span>参加できる人が最多</span>}<span className="chip-selected"><Icon name="check" size={14} />選択中</span></div>
            </div>
            <ul className="member-marks">
              {you && <li>{answered(you) ? <span className={`mark-circle v-${you.votes[index] ?? 'none'}`}><VoteMark vote={you.votes[index] ?? null} /></span> : <span className="badge-pending">未回答</span>}<strong>あなた</strong></li>}
              {others.map(answer => <li key={answer.name}><span className={`mark-circle v-${answer.votes[index] ?? 'none'}`}><VoteMark vote={answer.votes[index] ?? null} /></span><span>{answer.name}</span></li>)}
            </ul>
          </article>
          : <button type="button" key={item.date} className="cand-row" onClick={() => setChosen(index)} aria-label={`${label}、参加${count.yes}、未定${count.maybe}、欠席${count.no}。この候補日を選ぶ`}>
            <span className="cand-date"><span className="num">{shortDate(item.date)}</span><small className={dayTone(item.date)}>{weekday(item.date)}</small><span className="cand-time num">{item.time}〜</span></span>
            <span className="counts"><span>参加<b>{count.yes}</b></span><span>未定<b className="maybe">{count.maybe}</b></span><span>欠席<b>{count.no}</b></span></span>
            <Icon name="chevronRight" size={18} />
          </button>;
      })}
      {you && !answered(you) && <div className="you-row"><p>あなたはまだ未回答です</p><a className="soft-btn" href={`/r#${poll.token}`}><Icon name="edit" size={18} />回答する</a></div>}
    </section>

    <section className="desk-only matrix-card" aria-label="候補日ごとの回答">
      <table className="matrix">
        <thead><tr><th scope="col">メンバー</th>{poll.candidates.map((item, index) => <th scope="col" key={item.date}>
          <button type="button" className="matrix-date" aria-pressed={index === chosen} onClick={() => setChosen(index)}>
            <strong>{dateLabel(item.date)}</strong><span className="num">{item.time}〜</span>{index === chosen && <span className="chip-soft">選択中</span>}
          </button></th>)}</tr></thead>
        <tbody>{poll.answers.map(answer => <tr key={answer.name} className={answer === you ? 'you' : ''}>
          <th scope="row">{answer.name}{answer === you && '（あなた）'}</th>
          {poll.candidates.map((item, index) => <td key={item.date}><VoteMark vote={answer.votes[index] ?? null} withLabel /></td>)}
        </tr>)}</tbody>
      </table>
    </section>

    <div className="confirm-bar">
      <p className="desk-only best-note"><span>{chosen === best ? '参加できる人が最多' : '選択中の候補日'}</span><strong>{dateLabel(candidate.date)}{candidate.time}〜</strong></p>
      <button type="button" className="primary-btn wide" disabled={confirmed === chosen} onClick={() => setConfirmed(chosen)}>
        <Icon name="check" size={18} className="desk-only" />{confirmed === chosen ? '確定しました' : <><span className="m-only">{confirmLabel}</span><span className="desk-only">この日程に確定する</span></>}
      </button>
    </div>
  </AppShell>;
}
