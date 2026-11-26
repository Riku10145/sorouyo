import { useRef } from 'react';
import { AppShell } from '../../../components/AppShell';
import { Icon } from '../../../components/Icon';
import { LoginLink } from '../../../components/LoginCard';
import { useMe } from '../../../hooks/useMe';
import { confirmCandidate, issueInviteToken, unconfirmPoll } from '../api/polls';
import { PollStatus, type CopyLinkResult } from '../components/PollStatus';
import { useMemberPoll } from '../hooks/useMemberPoll';
import { memberPollView } from '../lib/poll';
import { displayName } from '../../../lib/account';

export function RemotePollStatus({ id, selectedDate }: { id: string; selectedDate: string }) {
  const me = useMe();
  const result = useMemberPoll(id);
  // hooks は早期returnより前に置く。Promise を保持して同時コピーの重複発行も防ぐ
  const issuedLink = useRef<Promise<CopyLinkResult> | null>(null);
  if (result === 'loading') return null;
  if (!result.poll) {
    const login = result.status === 401;
    return <AppShell active="polls" selectedDate={selectedDate} groups={[]} subpage>
      <div className="m-only m-back"><a className="text-btn" href="/polls"><Icon name="chevronLeft" size={20} />日程調整</a></div>
      <section className="notice-card" role="alert" style={{ margin: '24px 16px' }}>
        <Icon name="link" size={32} />
        <h2>{login ? 'ログインが必要です' : '調整を開けません'}</h2>
        <p>{login ? 'この日程調整はログインした主催者・メンバーだけが見られます。' : '権限がないか、削除された可能性があります。'}</p>
        {login && <LoginLink next={`/polls/${id}`} className="soft-btn"><Icon name="settings" size={18} />ログイン</LoginLink>}
      </section>
    </AppShell>;
  }
  if (me === undefined) return null; // 主催者判定が必要な詳細表示だけを待つ
  const remote = result.poll;
  const expired = remote.status === 'open' && !!remote.deadlineAt && remote.deadlineAt <= new Date().toISOString();
  const link = async (): Promise<CopyLinkResult> => {
    issuedLink.current ??= issueInviteToken(remote.id).then(token => {
      if (token === 'limit') return { error: 'limit' } as const;
      if (!token) return Promise.reject(new Error('no token'));
      return { url: `${window.location.origin}/r#${token}` } as const;
    });
    try {
      return await issuedLink.current;
    } catch {
      issuedLink.current = null; // 失敗は保持しない。次のコピーで発行をやり直せるように
      return { error: 'error' };
    }
  };
  const viewerName = me ? displayName(me) : undefined;
  return <PollStatus poll={memberPollView(remote)} selectedDate={selectedDate} expired={expired}
    canConfirm={me?.user.id === remote.creatorId} // 確定は主催者のみ（バックエンドも403で保護）
    canViewTally={me?.user.id === remote.creatorId}
    members={remote.members}
    viewerName={viewerName}
    onConfirm={index => confirmCandidate(remote.id, remote.candidates[index]!.id)}
    onUnconfirm={eventId => unconfirmPoll(remote.id, eventId)}
    onCopyLink={link}
    onAnswerLink={async () => { const result = await link(); if ('url' in result) window.location.href = result.url; }} />;
}
