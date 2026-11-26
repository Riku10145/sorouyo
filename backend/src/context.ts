import type { Context } from 'hono';
import type { AuthEnv } from './auth';

export interface DataEnv extends AuthEnv {
  DB: D1Database;
  ANALYTICS_TOKEN?: string;
  ANSWER_RESPONDENT_RATE_LIMIT?: RateLimit;
  ANSWER_IP_RATE_LIMIT?: RateLimit;
  INVITE_MEASURE_IP_RATE_LIMIT?: RateLimit;
  ANSWER_RESPONDENT_RATE_LIMIT_PER_MINUTE?: string;
  ANSWER_IP_RATE_LIMIT_PER_MINUTE?: string;
  INVITE_MEASURE_IP_RATE_LIMIT_PER_MINUTE?: string;
}

export type C = Context<{ Bindings: DataEnv }>;
