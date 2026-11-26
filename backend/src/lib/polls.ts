import type { PollRow } from './db';
import { now } from './time';

/** 受付中の調整が持つ状態。締切はミリ秒つきISOで保存し、文字列比較が時刻比較と一致する。 */
export type PollAcceptance = Pick<PollRow, 'status' | 'reopen_pending' | 'deadline_at'>;

/** SQLで書き込みを受付中に限定する条件。? には比較時刻のISO文字列を入れる。 */
export const ACCEPTING_POLL_WHERE = `status = 'open' AND reopen_pending = 0 AND (deadline_at IS NULL OR deadline_at > ?)`;

/** 画面表示や送信前確認に使う受付判定。SQL側の ACCEPTING_POLL_WHERE と同じ意味。 */
export const isPollAccepting = (poll: PollAcceptance, at = now()): boolean =>
  poll.status === 'open' && !poll.reopen_pending && (!poll.deadline_at || poll.deadline_at > at);
