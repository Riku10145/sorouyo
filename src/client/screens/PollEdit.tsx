import { useEffect, useState, type FormEvent } from 'react';
import { dateLabel } from '../../shared/model';
import { deletePoll, fetchMemberPoll, toJst, updatePoll, useMe, type MemberPoll } from '../api';
import { Dot, Icon, toast } from '../design/ui';
import { AppShell } from './Shell';
import { LoginCard } from './Auth';

type EditableCandidate = { id?: string; date: string; time: string | null };

const datetimeInput = (iso: string | null) => {
  if (!iso) return '';
  const jst = toJst(iso);
  return `${jst.date}T${jst.time}`;
};

/** /polls/<id>/edit: 受付中の調整を主催者が編集する（#9） */
export function PollEdit({ id, selectedDate }: { id: string; selectedDate: string }) {
  const me = useMe();
  const [result, setResult] = useState<{ poll?: MemberPoll; status: number } | 'loading'>('loading');
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [candidates, setCandidates] = useState<EditableCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchMemberPoll(id).then(found => {
      if (!active) return;
      setResult(found);
      if (found.poll) {
        setTitle(found.poll.title);
        setDeadline(datetimeInput(found.poll.deadlineAt));
        setCandidates(found.poll.candidates.map(c => ({ id: c.id, date: c.date, time: c.startTime })));
      }
    }).catch(() => { if (active) setResult({ status: 0 }); });
    return () => { active = false; };
  }, [id]);

  if (me === undefined || result === 'loading') return null;
  if (me === null) {
    return <AppShell active="polls" selectedDate={selectedDate} groups={[]} subpage>
      <LoginCard next={`/polls/${id}/edit`} />
    </AppShell>;
  }
  if (!result.poll) {
    return <AppShell active="polls" selectedDate={selectedDate} groups={[]} subpage>
      <section className="notice-card" role="alert" style={{ margin: '24px 16px' }}>
        <Icon name="link" size={32} /><h2>調整を開けません</h2>
        <p>権限がないか、削除された可能性があります。</p>
        <a className="soft-btn" href="/polls">日程調整へ戻る</a>
      </section>
    </AppShell>;
  }

  const reopen = new URLSearchParams(window.location.search).get('reopen') === '1';
  const poll = result.poll;
  const owner = me.user.id === poll.creatorId;
  const group = { id: poll.group.id, name: poll.group.name, color: poll.group.color };
  const original = new Map(poll.candidates.map(c => [c.id, c]));
  const voteCount = (candidateId?: string) => candidateId
    ? poll.answers.reduce((count, answer) => count + (answer.votes[candidateId] ? 1 : 0), 0)
    : 0;

  if (!owner || poll.status !== 'open') {
    return <AppShell active="polls" selectedDate={selectedDate} groups={[group]} subpage>
      <section className="notice-card" role="alert" style={{ margin: '24px 16px' }}>
        <Icon name="pollTab" size={32} /><h2>{owner ? '確定済みの調整です' : '編集できません'}</h2>
        <p>{owner ? '編集や削除をする前に、調整画面で確定を取り消してください。' : '日程調整を編集できるのは主催者だけです。'}</p>
        <a className="soft-btn" href={`/polls/${id}`}>調整画面へ戻る</a>
      </section>
    </AppShell>;
  }

  const updateCandidate = (index: number, patch: Partial<EditableCandidate>) =>
    setCandidates(current => current.map((item, i) => i === index ? { ...item, ...patch } : item));

  const removeCandidate = (index: number) => {
    const target = candidates[index]!;
    const votes = voteCount(target.id);
    const message = votes
      ? `${target.date ? dateLabel(target.date) : '未入力の候補'}には${votes}件の票があります。削除するとその票も消えます。削除しますか？`
      : `${target.date ? dateLabel(target.date) : '未入力の候補'}を候補から削除しますか？`;
    if (window.confirm(message)) setCandidates(current => current.filter((_, i) => i !== index));
  };

  const changedVotes = () => {
    let count = 0;
    for (const item of candidates) {
      if (!item.id) continue;
      const before = original.get(item.id);
      if (before && (before.date !== item.date || before.startTime !== item.time)) count += voteCount(item.id);
    }
    // 削除された候補は削除操作の確認ダイアログで件数を示済みなので、保存時に二重確認しない
    return count;
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) { setError('予定名を入力してください'); return; }
    if (!candidates.length || candidates.some(c => !c.date)) { setError('候補日を1つ以上入力してください'); return; }
    if (reopen && !deadline) { setError('再調整を始めるには新しい回答締切を設定してください'); return; }
    if (new Set(candidates.map(c => `${c.date}\0${c.time ?? ''}`)).size !== candidates.length) {
      setError('同じ日時の候補が重複しています'); return;
    }
    if (deadline && new Date(`${deadline}:00+09:00`).getTime() <= Date.now()) {
      setError('回答締切は未来の日時にしてください'); return;
    }
    const votes = changedVotes();
    if (votes && !window.confirm(`変更・削除される候補には合計${votes}件の票があります。票は消えますが、保存しますか？`)) return;
    setBusy(true);
    setError(null);
    const status = await updatePoll(id, {
      editVersion: poll!.editVersion,
      title: title.trim(),
      deadlineAt: deadline ? new Date(`${deadline}:00+09:00`).toISOString() : null,
      candidates: candidates.map(c => ({ id: c.id, date: c.date, time: c.time })),
    }).catch(() => 0);
    setBusy(false);
    if (status !== 200) {
      setError(status === 409 ? '編集中に新しい回答または別の変更が入りました。画面を開き直して内容を確認してください。' : '保存できませんでした。確定済みでないか確認して、時間をおいて再度お試しください。');
      return;
    }
    toast('日程調整を保存しました');
    window.location.href = `/polls/${id}`;
  };

  const removePoll = () => {
    if (!window.confirm('この日程調整を削除しますか？回答リンクは無効になり、回答も消えます。')) return;
    void deletePoll(id).then(ok => {
      if (!ok) { toast('日程調整を削除できませんでした'); return; }
      toast('日程調整を削除しました');
      window.location.href = '/polls';
    });
  };

  return <AppShell active="polls" selectedDate={selectedDate} groups={[group]} subpage>
    <div className="m-only m-back"><a className="text-btn" href={`/polls/${id}`}><Icon name="chevronLeft" size={20} />日程調整</a></div>
    <h1 className="page-title">日程調整を編集</h1>
    <form className="groups-body" onSubmit={save} noValidate>
      <section className="card form-card">
        <p className="eyebrow"><Dot group={group} />{group.name}</p>
        <label className="field">予定名
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={60} autoFocus />
        </label>
        {reopen && <p className="form-error" role="status">確定を取り消しました。再調整を始めるには新しい回答締切を設定してください。</p>}
        <label className="field">{reopen ? '回答締切（再調整では必須・日本時間）' : '回答締切（任意・日本時間）'}
          <input type="datetime-local" value={deadline} min={new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 16)} onChange={e => setDeadline(e.target.value)} />
        </label>
      </section>
      <section className="card form-card">
        <div className="section-head"><h2>候補日</h2><button type="button" className="text-btn" onClick={() => setCandidates(current => [...current, { date: '', time: null }])}><Icon name="plus" size={18} />候補日を追加</button></div>
        <p className="hint">候補の日時を変えると、その候補に入っていた票は消えます。残った候補への回答は保持されます。</p>
        <ul className="group-list">
          {candidates.map((candidate, index) => <li className="card" key={candidate.id ?? `new-${index}`} style={{ padding: 12 }}>
            <div className="edit-candidate-row">
              <input type="date" value={candidate.date} aria-label={`候補${index + 1}の日付`} onChange={e => updateCandidate(index, { date: e.target.value })} />
              <input type="time" value={candidate.time ?? ''} aria-label={`候補${index + 1}の開始時刻`} onChange={e => updateCandidate(index, { time: e.target.value || null })} />
              <button type="button" className="icon-btn ghost-btn" aria-label={`候補${index + 1}を削除`} onClick={() => removeCandidate(index)}><Icon name="close" size={18} /></button>
            </div>
          </li>)}
        </ul>
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="primary-btn wide" disabled={busy}>{busy ? '保存中…' : '変更を保存'}</button>
      <button type="button" className="ghost-btn wide" onClick={removePoll}><Icon name="close" size={18} />この日程調整を削除</button>
    </form>
  </AppShell>;
}
