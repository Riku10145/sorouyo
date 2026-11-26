import { expect, test } from 'vitest';
import { voteSchema } from './schema';

test('投票スキーマは○△×のみを受け付ける', () => {
  for (const value of ['yes', 'maybe', 'no']) expect(voteSchema.parse(value)).toBe(value);
  for (const value of ['', 'invalid', null, undefined, 0, {}, 'toString', '__proto__']) {
    expect(voteSchema.safeParse(value).success).toBe(false);
  }
});
