// 操作者と権限（docs/service-design.md「操作者と権限」の表をコード化したもの）
//
// 主催者: AuthKitセッションの利用者が調整の作成者（creatorId）と一致する場合だけ編集・確定できる。
// グループメンバー: AuthKitセッションの利用者が対象グループの memberIds に含まれる。
// リンク回答者: 有効な招待トークンを持つゲスト（guestId はブラウザのゲストCookie由来）。

export type Operation =
  | 'viewPoll' // 調整の閲覧（メンバーは所属グループの調整、ゲストは招待された調整のみ）
  | 'viewTally' // 回答状況・集計の閲覧
  | 'createPoll' // 所属グループでの調整作成
  | 'answerPoll' // ○△×の回答
  | 'updateOwnAnswer' // 自分の回答の更新
  | 'editPoll' // 調整の編集
  | 'confirmPoll' // 日程の確定・取り消し
  | 'manageGroup'; // グループ管理操作

export interface Subject {
  /** ログイン済み利用者のID（AuthKitの (iss, sub) に対応）。未ログインなら undefined。 */
  userId?: string;
  /** ゲストCookie由来の識別子。未確立なら undefined。 */
  guestId?: string;
}

export interface PollTarget {
  /** 調整の作成者（主催者）。 */
  creatorId: string;
  /** 対象グループに所属するメンバーの利用者ID一覧。 */
  memberIds: readonly string[];
  /** グループ管理権限を持つ利用者ID一覧。 */
  adminIds: readonly string[];
  /** 提示された招待トークンがこの調整に対して有効か。 */
  inviteValid: boolean;
}

const isMember = (s: Subject, t: PollTarget) => s.userId !== undefined && t.memberIds.includes(s.userId);
const isCreator = (s: Subject, t: PollTarget) => s.userId !== undefined && s.userId === t.creatorId;
const isGuest = (s: Subject, t: PollTarget) => !s.userId && s.guestId !== undefined && t.inviteValid;

export function can(subject: Subject, operation: Operation, target: PollTarget): boolean {
  switch (operation) {
    case 'viewPoll':
      // ゲストに他の予定やメンバー一覧は公開しない（招待された調整だけ）。
      return isMember(subject, target) || isCreator(subject, target) || isGuest(subject, target);
    case 'viewTally':
      return isCreator(subject, target);
    case 'createPoll':
      return isMember(subject, target) || isCreator(subject, target);
    case 'answerPoll':
      return isMember(subject, target) || isGuest(subject, target);
    case 'updateOwnAnswer':
      // どの回答が「自分の」かは回答者キー（利用者ID or ゲスト識別子）で書き込み時に判定する。
      return isMember(subject, target) || isGuest(subject, target);
    case 'editPoll':
    case 'confirmPoll':
      return isCreator(subject, target);
    case 'manageGroup':
      return subject.userId !== undefined && target.adminIds.includes(subject.userId);
  }
}

/** ゲストが確定後に同じリンクで確認できるのは決定日だけ。 */
export const guestVisibleFields = ['pollStatus', 'confirmedDate', 'candidates', 'ownAnswer'] as const;
