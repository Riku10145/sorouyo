import type { ReactNode } from 'react';
import { Brand } from '../../../components/Brand';
import { GuestFrame } from '../../../components/GuestFrame';
import { Icon } from '../../../components/Icon';
import { Envelope } from '../../../design/art';
import { dateLabel, timeLabel } from '../../../lib/date';
import { type Poll, deadlineText } from '../lib/poll';

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return <GuestFrame><header className="guest-header"><Brand size={28} /></header><h1 className="page-title">{title}</h1>{children}</GuestFrame>;
}

export const InvalidNotice = () => <Notice title="招待を開けません">
  <section className="notice-card" role="alert"><Icon name="link" size={32} /><h2>リンクをご確認ください</h2><p>招待リンクが無効です。送ってくれた方に、新しいリンクをお願いしてください。</p></section>
</Notice>;

export const InviteLoadError = ({ retry }: { retry: () => void }) => <Notice title="招待を読み込めませんでした">
  <section className="notice-card">
    <Icon name="alert" size={32} />
    <p role="alert">時間をおいて、同じリンクでお試しください。</p>
    <button type="button" className="primary-btn" onClick={retry}>もう一度試す</button>
  </section>
</Notice>;

export const ClosedNotice = ({ poll }: { poll: Poll }) => <Notice title="回答は締め切りました">
  <section className="invite-card"><Envelope width={64} height={46} /><h2>{poll.title}</h2><p className="strong">回答締切　{deadlineText(poll)}</p></section>
  <p className="note">回答の追加や変更は、幹事の{poll.host}さんに直接お知らせください。</p>
</Notice>;

export const ConfirmedNotice = ({ poll, decided }: { poll: Poll; decided: { date: string; time: string } }) => <Notice title="日程が決まりました">
  <section className="invite-card"><Envelope width={64} height={46} /><h2>{poll.title}</h2><p className="strong">{dateLabel(decided.date)} {timeLabel(decided.time)}に決まりました</p></section>
  <p className="note">回答の追加や変更は、幹事の{poll.host}さんに直接お知らせください。</p>
</Notice>;
