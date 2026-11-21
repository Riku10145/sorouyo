import { expect, test } from 'vitest';
import { answered, bestCandidate, dayTone, shortDate, tally, weekday } from './model';
import { findPoll, SAMPLE_EVENTS, SAMPLE_SELECTED_DATE } from './sample';

test('Paperと同じ餃子の会のサンプルで回答数と最多の候補日を求める', () => {
  const poll = findPoll('sample')!;
  expect(poll.answers.filter(answered)).toHaveLength(3);
  expect(tally(poll, 0)).toEqual({ yes: 1, maybe: 1, no: 1 });
  expect(tally(poll, 2)).toEqual({ yes: 1, maybe: 0, no: 2 });
  expect(bestCandidate(poll)).toBe(1);
  expect(findPoll('sample-closed')?.closed).toBe(true);
  expect(findPoll('unknown')).toBeUndefined();
});

test('参加が同数なら未定が多く欠席が少ない早い候補日を選ぶ', () => {
  const candidates = [{}, {}, {}];
  expect(bestCandidate({ candidates, answers: [{ name: 'a', votes: ['yes', 'yes', 'yes'] }, { name: 'b', votes: ['no', 'maybe', 'maybe'] }] })).toBe(1);
  expect(bestCandidate({ candidates, answers: [] })).toBe(0);
});

test('候補日の短い表記と曜日・休日の色を返す', () => {
  expect(shortDate('2026-11-08')).toBe('11/8');
  expect(weekday('2026-11-26')).toBe('木');
  expect(dayTone('2026-11-22')).toBe('sun');
  expect(dayTone('2026-11-21')).toBe('sat');
  expect(dayTone('2026-11-26')).toBeUndefined();
  expect(SAMPLE_EVENTS.filter(event => event.date === SAMPLE_SELECTED_DATE).map(event => event.title)).toEqual(['おうちランチ', '映画デート']);
});
