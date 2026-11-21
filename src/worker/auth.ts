import { Hono } from 'hono';
import type { Context, Env as HonoEnv } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { WorkOS } from '@workos-inc/node';

export interface AuthEnv {
  WORKOS_API_KEY?: string;
  WORKOS_CLIENT_ID?: string;
  WORKOS_COOKIE_PASSWORD?: string;
  WORKOS_REDIRECT_URI?: string;
  WORKOS_LOGOUT_RETURN_TO?: string;
}

export const SESSION_COOKIE = 'sorouyo_session';
export const STATE_COOKIE = 'sorouyo_state';
export const GUEST_COOKIE = 'sorouyo_guest';

export interface SessionUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

export interface SealedSession {
  authenticate(): Promise<
    | { authenticated: true; user: SessionUser; sessionId: string }
    | { authenticated: false }
  >;
  refresh(): Promise<
    | { authenticated: true; user: SessionUser; sessionId: string; sealedSession?: string }
    | { authenticated: false }
  >;
  getLogoutUrl(options?: { returnTo?: string }): Promise<string>;
}

export interface WorkosClient {
  userManagement: {
    getAuthorizationUrl(options: {
      clientId: string;
      redirectUri: string;
      provider: string;
      state: string;
    }): string;
    authenticateWithCode(options: {
      code: string;
      clientId: string;
      session: { sealSession: true; cookiePassword: string };
    }): Promise<{ sealedSession?: string; user: SessionUser }>;
    loadSealedSession(options: { sessionData: string; cookiePassword: string }): SealedSession;
  };
}

export interface AuthConfig {
  clientId: string;
  cookiePassword: string;
  redirectUri: string;
  logoutReturnTo: string;
}

export interface AuthDeps {
  workos: WorkosClient;
  config: AuthConfig;
}

export type GetAuthDeps = (c: Context<{ Bindings: AuthEnv }>) => AuthDeps | undefined;

let cached: { key: string; workos: WorkosClient } | undefined;

export function authDeps(c: Context<{ Bindings: AuthEnv }>): AuthDeps | undefined {
  const env = c.env;
  const clientId = env.WORKOS_CLIENT_ID;
  const cookiePassword = env.WORKOS_COOKIE_PASSWORD;
  if (!env.WORKOS_API_KEY || !clientId || !cookiePassword || cookiePassword.length < 32) {
    return undefined;
  }
  const origin = new URL(c.req.url).origin;
  const key = `${env.WORKOS_API_KEY}:${clientId}`;
  if (!cached || cached.key !== key) {
    cached = { key, workos: new WorkOS(env.WORKOS_API_KEY, { clientId }) as unknown as WorkosClient };
  }
  return {
    workos: cached.workos,
    config: {
      clientId,
      cookiePassword,
      redirectUri: env.WORKOS_REDIRECT_URI ?? `${origin}/api/auth/callback`,
      logoutReturnTo: env.WORKOS_LOGOUT_RETURN_TO ?? origin,
    },
  };
}

const secure = (c: Context) => new URL(c.req.url).protocol === 'https:';

const checkOrigin = (c: Context): boolean => {
  const origin = c.req.header('origin');
  return !origin || origin === new URL(c.req.url).origin;
};

/**
 * セッションCookieを検証してログイン中の利用者を返す。期限切れはSDKで更新し、
 * Cookieを置き換える。未ログイン・失効なら null。
 */
export async function resolveUser(c: Context, deps: AuthDeps): Promise<SessionUser | null> {
  const sessionData = getCookie(c, SESSION_COOKIE);
  if (!sessionData) return null;
  const session = deps.workos.userManagement.loadSealedSession({
    sessionData,
    cookiePassword: deps.config.cookiePassword,
  });
  let result = await session.authenticate();
  if (!result.authenticated) {
    const refreshed = await session.refresh();
    if (!refreshed.authenticated) return null;
    if (refreshed.sealedSession) {
      setCookie(c, SESSION_COOKIE, refreshed.sealedSession, sessionCookieOptions(c));
    }
    result = refreshed;
  }
  return result.user;
}

/**
 * 権限判定（shared/permissions.can）に渡す Subject をCookieから導く。
 * ログイン済みなら userId、未ログインでゲストCookieがあれば guestId。どちらも無ければ匿名。
 */
export async function resolveSubject(
  c: Context,
  deps?: AuthDeps,
): Promise<{ userId?: string; guestId?: string }> {
  const user = deps ? await resolveUser(c, deps) : null;
  if (user) return { userId: user.id };
  const guestId = getCookie(c, GUEST_COOKIE);
  return guestId ? { guestId } : {};
}

const sessionCookieOptions = (c: Context) => ({
  httpOnly: true,
  secure: secure(c),
  sameSite: 'Lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
});

export function buildAuthRoutes(getDeps: GetAuthDeps) {
  return new Hono<{ Bindings: AuthEnv }>()
    .get('/login', (c) => {
      const deps = getDeps(c);
      if (!deps) return c.json({ error: 'auth_not_configured' } as const, 503);
      const state = crypto.randomUUID();
      setCookie(c, STATE_COOKIE, state, {
        httpOnly: true,
        secure: secure(c),
        sameSite: 'Lax',
        path: '/',
        maxAge: 600,
      });
      const url = deps.workos.userManagement.getAuthorizationUrl({
        clientId: deps.config.clientId,
        redirectUri: deps.config.redirectUri,
        provider: 'authkit',
        state,
      });
      return c.redirect(url, 302);
    })
    .get('/callback', async (c) => {
      const deps = getDeps(c);
      if (!deps) return c.json({ error: 'auth_not_configured' } as const, 503);
      const code = c.req.query('code');
      const state = c.req.query('state');
      if (!code || !state || state !== getCookie(c, STATE_COOKIE)) {
        return c.json({ error: 'invalid_state' } as const, 400);
      }
      deleteCookie(c, STATE_COOKIE, { path: '/' });
      try {
        const result = await deps.workos.userManagement.authenticateWithCode({
          code,
          clientId: deps.config.clientId,
          session: { sealSession: true, cookiePassword: deps.config.cookiePassword },
        });
        if (!result.sealedSession) return c.json({ error: 'session_unsealed' } as const, 502);
        setCookie(c, SESSION_COOKIE, result.sealedSession, sessionCookieOptions(c));
        return c.redirect('/settings', 302);
      } catch {
        return c.json({ error: 'auth_failed' } as const, 401);
      }
    })
    .get('/me', async (c) => {
      const deps = getDeps(c);
      if (!deps) return c.json({ error: 'auth_not_configured' } as const, 503);
      const user = await resolveUser(c, deps);
      if (!user) return c.json({ error: 'unauthenticated' } as const, 401);
      return c.json({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
        },
      } as const);
    })
    .post('/logout', async (c) => {
      if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
      const sessionData = getCookie(c, SESSION_COOKIE);
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
      const deps = getDeps(c);
      if (!deps || !sessionData) return c.json({ logoutUrl: null } as const);
      try {
        const session = deps.workos.userManagement.loadSealedSession({
          sessionData,
          cookiePassword: deps.config.cookiePassword,
        });
        const logoutUrl = await session.getLogoutUrl({ returnTo: deps.config.logoutReturnTo });
        return c.json({ logoutUrl } as const);
      } catch {
        return c.json({ logoutUrl: null } as const);
      }
    });
}

export const authRoutes = buildAuthRoutes(authDeps);

export const guestRoutes = new Hono<HonoEnv>()
  .post('/session', (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    if (!getCookie(c, GUEST_COOKIE)) {
      setCookie(c, GUEST_COOKIE, crypto.randomUUID(), {
        httpOnly: true,
        secure: secure(c),
        sameSite: 'Lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return c.body(null, 204);
  });
