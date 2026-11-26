import { useEffect, useState } from 'react';
import type { Vote } from '../../../../../shared/schema';
import { Brand } from '../../../components/Brand';
import { GuestFrame } from '../../../components/GuestFrame';
import { fetchInvite, submitAnswer, type AnswerResult, type InvitePoll } from '../api/invite';
import { invitePollView } from '../lib/poll';
import { GuestAnswerForm } from './GuestAnswerForm';
import { InvalidNotice, InviteLoadError, ClosedNotice, ConfirmedNotice } from './GuestNotices';

/** 実データの回答リンク（/r#<token>）。トークンをAPIに渡して対象の調整だけを取得する。 */
export function GuestInvite({ token }: { token: string }) {
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
  const poll = invitePollView(result, token);
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
  return <GuestAnswerForm key={result.id} poll={poll} initial={initial} onSubmit={send} usageStartToken={token} />;
}
