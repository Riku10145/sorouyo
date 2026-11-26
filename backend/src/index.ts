import { Hono } from 'hono';
import { authRoutes, guestRoutes } from './auth';
import { dataRoutes } from './data';
import type { DataEnv } from './context';

const app = new Hono<{ Bindings: DataEnv }>()
  .get('/api/health', (c) => c.json({ ok: true } as const))
  .route('/api/auth', authRoutes)
  .route('/api/guest', guestRoutes)
  .route('/api', dataRoutes)
  .notFound((c) => c.json({ error: 'Not Found' } as const, 404));

export type AppType = typeof app;
export default app;
