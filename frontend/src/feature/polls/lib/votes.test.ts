import { expect, test } from 'vitest';
import { voteSchema } from '../../../../../shared/schema';
import { VOTES, tally } from './votes';

test('○△×を集計し、未回答・不正な回答は数えない', () => {
  const answers = [{ votes: ['yes', 'yes', 'no'] }, { votes: ['maybe', 'yes', 'maybe'] }, { votes: ['no', 'yes', 'yes'] }];
  expect(tally({ answers }, 1)).toEqual({ yes: 3, maybe: 0, no: 0 });
  expect(tally({ answers }, 0)).toEqual({ yes: 1, maybe: 1, no: 1 });
  expect(tally({ answers: [] }, 0)).toEqual({ yes: 0, maybe: 0, no: 0 });
  expect(tally({ answers: ['', 'invalid', null, undefined, 0, {}, 'toString', '__proto__'].map(vote => ({ votes: [vote] })) }, 0)).toEqual({ yes: 0, maybe: 0, no: 0 });
  expect(tally({ answers }, 99)).toEqual({ yes: 0, maybe: 0, no: 0 });
  expect(new Set(VOTES.map(({ value }) => value))).toEqual(new Set(voteSchema.options));
  expect(VOTES.map(({ mark }) => mark)).toEqual(['○', '△', '×']);
});
