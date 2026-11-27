import { useHashToken } from '../../../hooks/useHashToken';
import { GuestAnswerForm } from '../components/GuestAnswerForm';
import { GuestInvite } from '../components/GuestInvite';
import { ClosedNotice } from '../components/GuestNotices';
import { findPoll } from '../lib/sample';

export function GuestAnswer() {
  const token = useHashToken();
  const sample = findPoll(token);
  if (sample) {
    if (sample.closed) return <ClosedNotice poll={sample} />;
    return <GuestAnswerForm key={sample.token} poll={sample} />;
  }
  return <GuestInvite key={token} token={token} />;
}
