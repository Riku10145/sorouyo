import { Hono } from 'hono';

const app = new Hono()
  .get('/api/health', (c) => c.json({ ok: true } as const))
  .notFound((c) => c.json({ error: 'Not Found' } as const, 404));

export type AppType = typeof app;
export default app;
