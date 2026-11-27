import { describe, expect, test } from 'vitest';
import { can, type PollTarget, type Subject } from './permissions';

const target: PollTarget = {
  creatorId: 'user_host',
  memberIds: ['user_host', 'user_member'],
  adminIds: ['user_host'],
  inviteValid: true,
};

const host: Subject = { userId: 'user_host' };
const member: Subject = { userId: 'user_member' };
const otherUser: Subject = { userId: 'user_other' }; // 別アカウント（非メンバー）
const guest: Subject = { guestId: 'guest_1' };
const anonymous: Subject = {};

describe('主催者（調整の作成者）', () => {
  test('集計の閲覧・編集・確定・グループ管理ができる', () => {
    for (const op of ['viewTally', 'editPoll', 'confirmPoll', 'manageGroup'] as const) {
      expect(can(host, op, target), op).toBe(true);
    }
  });
  test('グループを外れた作成者には権限が残らない', () => {
    const removed = { ...target, memberIds: ['user_member'], adminIds: [] };
    for (const op of ['viewPoll', 'viewTally', 'createPoll', 'answerPoll', 'updateOwnAnswer', 'editPoll', 'confirmPoll', 'manageGroup'] as const) {
      expect(can(host, op, removed), op).toBe(false);
    }
  });
});

describe('グループメンバー', () => {
  test('所属先の調整の閲覧・作成・回答・自分の回答更新ができる', () => {
    for (const op of ['viewPoll', 'createPoll', 'answerPoll', 'updateOwnAnswer'] as const) {
      expect(can(member, op, target), op).toBe(true);
    }
  });
  test('作成者でないメンバーは編集・確定・集計閲覧・グループ管理ができない', () => {
    for (const op of ['editPoll', 'confirmPoll', 'viewTally', 'manageGroup'] as const) {
      expect(can(member, op, target), op).toBe(false);
    }
  });
});

describe('リンク回答者（有効な招待トークンを持つゲスト）', () => {
  test('招待された調整の閲覧・回答・自分の回答更新だけができる', () => {
    expect(can(guest, 'viewPoll', target)).toBe(true);
    expect(can(guest, 'answerPoll', target)).toBe(true);
    expect(can(guest, 'updateOwnAnswer', target)).toBe(true);
    for (const op of ['viewTally', 'createPoll', 'editPoll', 'confirmPoll', 'manageGroup'] as const) {
      expect(can(guest, op, target), op).toBe(false);
    }
  });
  test('失効した招待では閲覧も回答もできない', () => {
    const expired = { ...target, inviteValid: false };
    expect(can(guest, 'viewPoll', expired)).toBe(false);
    expect(can(guest, 'answerPoll', expired)).toBe(false);
  });
  test('ログイン済み利用者はゲストCookieではなく自分の所属で判定される', () => {
    const loggedInOther = { userId: 'user_other', guestId: 'guest_1' };
    expect(can(loggedInOther, 'viewPoll', target)).toBe(false);
  });
});

describe('別アカウント・匿名', () => {
  test('別アカウントには元の主催者の権限が引き継がれない', () => {
    for (const op of ['viewPoll', 'viewTally', 'createPoll', 'answerPoll', 'editPoll', 'confirmPoll', 'manageGroup'] as const) {
      expect(can(otherUser, op, target), op).toBe(false);
    }
  });
  test('Cookieなしの匿名は何もできない', () => {
    for (const op of ['viewPoll', 'answerPoll', 'updateOwnAnswer'] as const) {
      expect(can(anonymous, op, target), op).toBe(false);
    }
  });
  test('別のグループのメンバーであることは対象グループの権限にならない', () => {
    const otherGroup = { ...target, memberIds: ['user_other_group'] };
    expect(can(member, 'viewPoll', otherGroup)).toBe(false);
  });
});
