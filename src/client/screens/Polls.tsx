import { useEffect, useState, type FormEvent } from 'react';
import { DAYS, dateLabel, dayTone, monthCells, shiftedMonth, shortDate, weekday } from '../../shared/model';
import { createPoll, fetchGroups, fetchPolls, toJst, useMe, type GroupInfo, type PollSummary } from '../api';
import { Brand, Dot, Icon, toast, type DisplayGroup } from '../design/ui';
import { AppShell } from './Shell';
import { LoginCard } from './Auth';
import { todayInTokyo } from './Home';

const statusOf = (poll: PollSummary) =>
  poll.status === 'confirmed'
    ? { cls: 'confirmed', label: poll.confirmed ? `${shortDate(poll.confirmed.date)}に確定` : '確定' }
    : poll.accepting ? { cls: 'open', label: '受付中' } : { cls: 'expired', label: '締切済み' };

function PollRow({ poll }: { poll: PollSummary }) {
  const status = statusOf(poll);
  const deadline = poll.deadlineAt ? toJst(poll.deadlineAt) : null;
  return <a className="poll-row card" href={`/polls/${poll.id}`}>
    <span className="poll-row-main">
      <strong>{poll.title}</strong>
      <span className="poll-meta">
        <Dot group={poll.group} />{poll.group.name}
        <span aria-hidden="true">・</span>候補{poll.candidatesCount}日
        <span aria-hidden="true">・</span>回答{poll.answersCount}人
        {deadline && <><span aria-hidden="true">・</span>締切 {shortDate(deadline.date)} {deadline.time}</>}
      </span>
    </span>
    <span className={`poll-status ${status.cls}`}>{status.label}{poll.creator && '・主催'}</span>
    <Icon name="chevronRight" size={18} />
  </a>;
}

/** /polls 日程調整一覧 */
export function Polls() {
  const me = useMe();
  const [groups, setGroups] = useState<GroupInfo[] | 'error' | null>(null);
  const [polls, setPolls] = useState<PollSummary[] | 'error' | null>(null);
  const [visible, setVisible] = useState<ReadonlySet<string>>();

  useEffect(() => {
    if (!me) return;
    void (async () => {
      const [groupList, pollList] = await Promise.all([fetchGroups(), fetchPolls()]);
      setGroups(groupList ?? 'error');
      setPolls(pollList.polls ?? 'error');
    })().catch(() => { setGroups('error'); setPolls('error'); });
  }, [me]);

  if (me === undefined) return null;
  if (me === null) {
    return <AppShell active="polls" selectedDate="" groups={[]} subpage>
      <LoginCard next="/polls" />
      <p className="hint" style={{ margin: '0 16px' }}><a href="/polls/sample">サンプルの日程調整画面を見る</a></p>
    </AppShell>;
  }

  const displayGroups: DisplayGroup[] = Array.isArray(groups) ? groups.map(g => ({ id: g.id, name: g.name, color: g.color })) : [];
  const shown = Array.isArray(polls) ? polls.filter(poll => !visible || visible.has(poll.group.id)) : [];
  const toggle = (id: string) => setVisible(current => {
    const next = new Set(current ?? displayGroups.map(g => g.id));
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return <AppShell active="polls" selectedDate="" groups={displayGroups} visible={visible} onToggleGroup={displayGroups.length > 1 ? toggle : undefined}>
    <header className="m-header"><Brand /><a className="text-btn" href="/settings"><Icon name="settings" size={20} />設定</a></header>
    <h1 className="page-title">日程調整</h1>
    <div className="groups-body">
      {polls === 'error' ? <p className="form-error" role="alert">読み込めませんでした。時間をおいて再度お試しください。</p>
        : polls === null ? <p className="loading-note">読み込み中…</p> : <>
        {shown.length === 0 && (polls.length === 0 ? <section className="empty-hero">
          <h2>まだ日程調整がありません</h2>
          <p>候補日をまとめて選んで、LINEなどに貼れる回答リンクを作れます。</p>
        </section> : <p className="hint">表示中のグループに日程調整はありません。</p>)}
        <ul className="group-list">
          {shown.map(poll => <li key={poll.id}><PollRow poll={poll} /></li>)}
        </ul>
        {groups !== null && (groups === 'error'
          ? <p className="form-error" role="alert">グループを読み込めませんでした。</p>
          : (groups.length > 0
            ? <a className="primary-btn wide" href="/polls/new"><Icon name="plus" size={18} />日程調整を作成</a>
            : <p className="hint"><a href="/groups">まずグループを作成してください</a></p>))}
      </>}
    </div>
  </AppShell>;
}

/** /polls/new: 日付を複数選ぶ → 内容を確認して作成 → リンク発行 */
export function PollCreate() {
  const me = useMe();
  const [groups, setGroups] = useState<GroupInfo[] | 'error' | null>(null);
  const [step, setStep] = useState<'dates' | 'form' | 'done'>('dates');
  const [month, setMonth] = useState(todayInTokyo().slice(0, 7));
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [times, setTimes] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [groupId, setGroupId] = useState('');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; token: string } | null>(null);

  useEffect(() => {
    if (!me) return;
    void fetchGroups().then(list => setGroups(list ?? 'error')).catch(() => setGroups('error'));
  }, [me]);

  if (me === undefined || (me && groups === null)) return null;
  if (me === null) {
    return <AppShell active="polls" selectedDate="" groups={[]} subpage>
      <LoginCard next="/polls/new" />
    </AppShell>;
  }
  if (groups === 'error') {
    return <AppShell active="polls" selectedDate="" groups={[]} subpage>
      <p className="form-error" role="alert" style={{ margin: '24px 16px' }}>読み込めませんでした。時間をおいて再度お試しください。</p>
    </AppShell>;
  }
  if (!groups!.length) {
    return <AppShell active="polls" selectedDate="" groups={[]} subpage>
      <section className="notice-card" role="alert" style={{ margin: '24px 16px' }}>
        <Icon name="groupsTab" size={32} /><h2>まずグループを作成してください</h2>
        <p>日程調整はグループの予定として作ります。</p>
        <a className="soft-btn" href="/groups">グループページへ</a>
      </section>
    </AppShell>;
  }

  const selectedGroup = groups!.find(g => g.id === (groupId || groups![0]!.id))!;
  const today = todayInTokyo();
  const dates = [...picked].sort();
  const cells = monthCells(month);
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];

  const toggleDate = (date: string) => {
    // state更新内で副作用を起こさないよう上限判定は外で行う（Strict Modeの再実行対策）
    if (!picked.has(date) && picked.size >= 31) { toast('候補日は31日までです'); return; }
    setPicked(current => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return; // 二重送信防止
    if (!title.trim()) { setError('予定名を入力してください'); return; }
    if (!dates.length) { setError('候補日を1つ以上選んでください'); return; }
    if (dates.length > 31) { setError('候補日は31日までに減らしてください'); return; }
    // 締切入力は日本時間として解釈し、過去の締切は回答できない調整になるため弾く
    if (deadline && new Date(`${deadline}:00+09:00`).getTime() <= Date.now()) {
      setError('回答締切は未来の日時にしてください'); return;
    }
    setBusy(true);
    setError(null);
    const created = await createPoll(selectedGroup.id, {
      title: title.trim(),
      deadlineAt: deadline ? new Date(`${deadline}:00+09:00`).toISOString() : null,
      candidates: dates.map(date => ({ date, time: times[date] || null })),
    }).catch(() => null); // 通信断もフォームを保持して再送可能に
    setBusy(false);
    if (!created) { setError('作成できませんでした。時間をおいて再度お試しください。'); return; }
    setResult(created);
    setStep('done');
    toast('日程調整を作成しました');
  };

  const link = result ? `${window.location.origin}/r#${result.token}` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast('回答リンクをコピーしました'); }
    catch { window.prompt('回答リンクをコピーしてください', link); }
  };

  return <AppShell active="polls" selectedDate="" groups={[selectedGroup]} subpage>
    <div className="m-only m-back"><a className="text-btn" href="/polls"><Icon name="chevronLeft" size={20} />日程調整</a></div>
    <h1 className="page-title">日程調整を作成</h1>

    {step === 'dates' && <div className="groups-body">
      <p className="hint">候補にしたい日を選んでください。続けて複数の日を選べます。</p>
      <section className="calendar-area" aria-label="候補日を選ぶカレンダー">
        <div className="month-bar">
          <h2 className="month-title"><span className="month-year">{year}年</span><span className="month-number">{monthNumber}<small>月</small></span></h2>
          <div className="month-actions">
            <button type="button" className="icon-btn ghost-btn" aria-label="前の月" onClick={() => setMonth(shiftedMonth(month, -1))}><Icon name="chevronLeft" /><span className="desk-only">前月</span></button>
            <button type="button" className="icon-btn ghost-btn" aria-label="次の月" onClick={() => setMonth(shiftedMonth(month, 1))}><Icon name="chevronRight" /><span className="desk-only">翌月</span></button>
          </div>
        </div>
        <div className="calendar" role="grid" aria-label={`${year}年${monthNumber}月`}>
          <div className="cal-row cal-head" role="row">{DAYS.map((day, i) => <span role="columnheader" key={day} className={i === 0 ? 'sun' : i === 6 ? 'sat' : ''}>{day}</span>)}</div>
          {Array.from({ length: cells.length / 7 }, (_, week) => <div className="cal-row" role="row" key={week}>
            {cells.slice(week * 7, week * 7 + 7).map(date => {
              const order = dates.indexOf(date);
              return <button type="button" role="gridcell" key={date} disabled={date < today}
                className={`cal-cell pick-cell ${dayTone(date) ?? ''} ${date.startsWith(month) ? '' : 'outside'}${order >= 0 ? ' picked' : ''}`}
                aria-pressed={order >= 0} aria-label={`${dateLabel(date)}${order >= 0 ? `、候補${order + 1}番目` : ''}`}
                onClick={() => toggleDate(date)}>
                <span className="cal-num">{Number(date.slice(8))}</span>
                {order >= 0 && <span className="pick-num" aria-hidden="true">{order + 1}</span>}
              </button>;
            })}
          </div>)}
        </div>
      </section>
      {dates.length > 0 && <ul className="pick-chips" aria-label="選択中の候補日">
        {dates.map((date, i) => <li key={date}><span className="pick-num" aria-hidden="true">{i + 1}</span>{dateLabel(date)}
          <button type="button" aria-label={`${dateLabel(date)}を候補から外す`} onClick={() => toggleDate(date)}><Icon name="close" size={14} /></button>
        </li>)}
      </ul>}
      <button type="button" className="primary-btn wide" disabled={!dates.length} onClick={() => setStep('form')}>
        <Icon name="arrowRight" size={18} />{dates.length ? `${dates.length}日で作成に進む` : '候補日を選んでください'}
      </button>
    </div>}

    {step === 'form' && <form className="groups-body" onSubmit={submit} noValidate>
      <button type="button" className="text-btn" onClick={() => { setError(null); setStep('dates'); }}><Icon name="chevronLeft" size={18} />日付を選び直す（{dates.length}日選択中）</button>
      <label className="field">予定名
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={60} placeholder="例：餃子の会、忘年会" autoFocus aria-invalid={!!error} />
      </label>
      <label className="field">グループ
        <select value={selectedGroup.id} onChange={e => setGroupId(e.target.value)}>
          {groups!.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </label>
      <fieldset className="field">
        <legend>候補ごとの開始時刻（空欄なら終日）</legend>
        <ul className="cand-times">
          {dates.map(date => <li key={date}>
            <span><strong>{dateLabel(date)}</strong><small className={dayTone(date)}>{weekday(date)}</small></span>
            <input type="time" value={times[date] ?? ''} aria-label={`${dateLabel(date)}の開始時刻`}
              onChange={e => setTimes(current => ({ ...current, [date]: e.target.value }))} />
          </li>)}
        </ul>
      </fieldset>
      <label className="field">回答締切（任意・日本時間）
        {/* 入力は日本時間として扱うため min も日本時間の現在時刻で計算（端末のTZに依存させない） */}
        <input type="datetime-local" value={deadline} min={new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 16)} onChange={e => setDeadline(e.target.value)} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="primary-btn wide" disabled={busy}>{busy ? '作成中…' : '日程調整を作成'}</button>
    </form>}

    {step === 'done' && result && <div className="groups-body">
      <section className="card">
        <h2>日程調整を作成しました</h2>
        <p className="hint">このリンクをLINEなどで送ると、相手はアプリ・ログインなしで○△×を回答できます。</p>
        <p className="copy-line"><input readOnly value={link} onFocus={e => e.target.select()} aria-label="回答リンク" /><button type="button" className="soft-btn" onClick={() => void copy()}><Icon name="copy" size={16} />コピー</button></p>
        <div className="about-actions">
          <a className="primary-btn" href={`/polls/${result.id}`}><Icon name="pollTab" size={18} />回答状況を開く</a>
          <a className="ghost-btn" href="/polls">日程調整一覧へ</a>
        </div>
      </section>
    </div>}
  </AppShell>;
}
