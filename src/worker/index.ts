import { Hono } from 'hono';
import { authRoutes, guestRoutes } from './auth';

const app = new Hono()
  .get('/api/health', (c) => c.json({ ok: true } as const))
  .route('/api/auth', authRoutes)
  .route('/api/guest', guestRoutes)
  .notFound((c) => c.json({ error: 'Not Found' } as const, 404));

export type AppType = typeof app;
export default app;
