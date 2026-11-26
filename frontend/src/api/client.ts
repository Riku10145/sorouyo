import { hc } from 'hono/client';
import type { AppType } from '../../../backend/src/index';

export const api = hc<AppType>(window.location.origin);
