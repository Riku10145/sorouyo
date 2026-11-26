import { expect, test } from 'vitest';
import { app } from './index';

test('health returns JSON 200', async () => {
  const response = await app.request('/api/health');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toEqual({ ok: true });
});

test('unknown API returns JSON 404', async () => {
  const response = await app.request('/api/nope');
  expect(response.status).toBe(404);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toEqual({ error: 'Not Found' });
});
