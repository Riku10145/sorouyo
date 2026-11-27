import { expect, test } from 'vitest';
import { dateKey, dateFromKey, validDate, dateLabel, monthCells, shiftedMonth, DAYS } from './date';

test('月カレンダーは日曜から土曜までを表示し、年をまたいで移動できる', () => {
  const november = monthCells('2026-11');
  expect(november[0]).toBe('2026-11-01');
  expect(november.at(-1)).toBe('2026-12-05');
  expect(november).toHaveLength(35);
  expect(monthCells('2026-05')).toHaveLength(42);
  expect(shiftedMonth('2026-12', 1)).toBe('2027-01');
  expect(shiftedMonth('2026-01', -1)).toBe('2025-12');
  expect(validDate('2024-02-29')).toBe(true);
  expect(validDate('2026-02-29')).toBe(false);
});

test('日付キーと日本語ラベルを生成する', () => {
  expect(dateKey(new Date(2026, 0, 2))).toBe('2026-01-02');
  expect(dateKey(dateFromKey('2026-11-21'))).toBe('2026-11-21');
  expect(dateLabel('2026-11-21')).toBe('11月21日（土）');
  expect(dateLabel('2026-11-21', { year: true })).toBe('2026年11月21日（土）');
  expect(DAYS).toEqual(['日', '月', '火', '水', '木', '金', '土']);
});

test('空・不正な日付を拒否する', () => {
  for (const value of ['', null, undefined, 123, 'bad', '2026-1-01', '2026-13-01', '2026-04-31']) {
    expect(validDate(value)).toBe(false);
  }
  expect(Number.isNaN(dateFromKey('').getTime())).toBe(true);
});
