import { describe, expect, test } from 'vitest';
import { digestBody, fireAt, shouldFire } from './notifications';

describe('#32 予定通知の判定', () => {
  test('指定時刻を過ぎていて当日未通知なら出す', () => {
    const now = new Date(2026, 3, 4, 9, 0); // 4月4日 9時
    expect(shouldFire(now, '08:00', null)).toBe(true);
  });

  test('指定時刻の前なら出さない', () => {
    const now = new Date(2026, 3, 4, 7, 59);
    expect(shouldFire(now, '08:00', null)).toBe(false);
  });

  test('同じ日に2回は出さない', () => {
    const now = new Date(2026, 3, 4, 20, 0);
    const today = '2026-04-04';
    expect(shouldFire(now, '08:00', today)).toBe(false);
    // 前日に出した記録なら当日分は出す
    expect(shouldFire(now, '08:00', '2026-04-03')).toBe(true);
  });

  test('通知時刻は端末ローカルのその日の時刻になる', () => {
    const now = new Date(2026, 3, 4, 12, 30);
    const at = fireAt(now, '07:30');
    expect(at.getHours()).toBe(7);
    expect(at.getMinutes()).toBe(30);
    expect(at.getDate()).toBe(4);
  });

  test('通知本文は時刻つきの予定から順に読める形にまとめる', () => {
    expect(digestBody([
      { title: 'ランチ', startTime: '12:00' },
      { title: '歯医者', startTime: null },
    ])).toBe('12:00〜 ランチ、終日 歯医者');
  });
});
