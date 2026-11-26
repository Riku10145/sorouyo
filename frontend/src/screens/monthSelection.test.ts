import { expect, test } from 'vitest';
import { monthSelection } from './monthSelection';

test('month navigation selects the first day, including across years', () => {
  expect(monthSelection('2026-11', 1, '2026-11-22')).toBe('2026-12-01');
  expect(monthSelection('2026-11', -1, '2026-11-22')).toBe('2026-10-01');
  expect(monthSelection('2026-12', 1, '2026-11-22')).toBe('2027-01-01');
  expect(monthSelection('2026-01', -1, '2026-11-22')).toBe('2025-12-01');
});

test('returning to the current month selects today from either direction', () => {
  expect(monthSelection('2026-10', 1, '2026-11-22')).toBe('2026-11-22');
  expect(monthSelection('2026-12', -1, '2026-11-22')).toBe('2026-11-22');
});
