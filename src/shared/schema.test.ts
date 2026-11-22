import { expect, test } from 'vitest';
import { VOTES } from './model';
import { voteSchema } from './schema';

test('投票スキーマは○△×のみを受け付ける', () => {
  for (const { value } of VOTES) expect(voteSchema.parse(value)).toBe(value);
  for (const value of ['', 'invalid', null, undefined, 0, {}, 'toString', '__proto__']) {
    expect(voteSchema.safeParse(value).success).toBe(false);
  }
});
