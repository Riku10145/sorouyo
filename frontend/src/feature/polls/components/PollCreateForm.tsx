import { useState, type FormEvent } from 'react';
import type { GroupInfo } from '../../../api/groups';
import { AppShell } from '../../../components/AppShell';
import { Icon } from '../../../components/Icon';
import { toast } from '../../../components/Toaster';
import { dateLabel, dayTone, weekday, todayInTokyo } from '../../../lib/date';
import { createPoll } from '../api/polls';
import { CandidateDatePicker } from './CandidateDatePicker';

export function PollCreateForm({ groups }: { groups: GroupInfo[] }) {
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

  const selectedGroup = groups.find(g => g.id === (groupId || groups[0]!.id))!;
  const dates = [...picked].sort();
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

    {step === 'dates' && <CandidateDatePicker month={month} dates={dates} onMonth={setMonth} onToggle={toggleDate} onNext={() => setStep('form')} />}

    {step === 'form' && <form className="groups-body" onSubmit={submit} noValidate>
      <button type="button" className="text-btn" onClick={() => { setError(null); setStep('dates'); }}><Icon name="chevronLeft" size={18} />日付を選び直す（{dates.length}日選択中）</button>
      <label className="field">予定名
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={60} placeholder="例：餃子の会、忘年会" autoFocus aria-invalid={!!error} />
      </label>
      <label className="field">グループ
        <select value={selectedGroup.id} onChange={e => setGroupId(e.target.value)}>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
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
