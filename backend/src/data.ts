import { Hono } from 'hono';
import { authDeps, type GetAuthDeps } from './auth';
import type { DataEnv } from './context';
import { analyticsRoutes } from './feature/analytics/routes';
import { eventsRoutes } from './feature/events/routes';
import { groupsRoutes } from './feature/groups/routes';
import { inviteRoutes } from './feature/invite/routes';
import { pollsRoutes } from './feature/polls/routes';
import { settingsRoutes } from './feature/settings/routes';
import { makeSubjectOf } from './lib/access';

export function buildDataRoutes(getDeps: GetAuthDeps) {
  const subjectOf = makeSubjectOf(getDeps);
  return new Hono<{ Bindings: DataEnv }>()
    .route('/', groupsRoutes(subjectOf))
    .route('/', eventsRoutes(subjectOf))
    .route('/', pollsRoutes(subjectOf))
    .route('/', settingsRoutes(subjectOf))
    .route('/', analyticsRoutes)
    .route('/', inviteRoutes(subjectOf));
}

export const dataRoutes = buildDataRoutes(authDeps);
