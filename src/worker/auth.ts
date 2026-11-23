import { Hono } from 'hono';
import type { Context } from 'hono';
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
export const NEXT_COOKIE = 'sorouyo_next';

/**
 * ログイン後の戻り先の検証。文字列の先頭だけでは `/\evil.com` のような指定も通ってしまうため、
 * アプリ自身のオリジンを基準にURLとして解析し、同じオリジンのときだけ正規化済みのパスを返す。
 */
export const safeNext = (next: string | null | undefined, base: string): string | null => {
  if (!next || next.length > 500) return null;
  try {
    const url = new URL(next, base);
    if (url.origin !== new URL(base).origin) return null;
    const path = url.pathname + url.search + url.hash;
    // `/%2e%2e//host` のような指定が `//host` に正規化されることがある。
    // `//` で始まる値はスキーム相対URLとして外部サイトへ誘導されるため返さない
    return path.startsWith('//') ? null : path;
  } catch {
    return null;
  }
};
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

// --- ゲストCookieの署名 -----------------------------------------------------
// ゲストCookieは改ざんされると他者のguestIdを名乗れるので HMAC-SHA256 で署名する。
// 鍵は WORKOS_COOKIE_PASSWORD を使い、認証未設定の環境ではインスタンスごとの乱数に
// 退避する（再起動で古いCookieは無効になり、次回POSTで再発行される）。

let fallbackGuestSecret: string | undefined;
const guestSecret = (env: AuthEnv | undefined) =>
  env?.WORKOS_COOKIE_PASSWORD && env.WORKOS_COOKIE_PASSWORD.length >= 32
    ? env.WORKOS_COOKIE_PASSWORD
    : (fallbackGuestSecret ??= crypto.randomUUID());

const guestKeys = new Map<string, Promise<CryptoKey>>();
const guestKey = (secret: string) => {
  let key = guestKeys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
    );
    guestKeys.set(secret, key);
  }
  return key;
};

const b64u = (data: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(data))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

const signGuestId = async (guestId: string, env: AuthEnv | undefined) => {
  const signature = await crypto.subtle.sign('HMAC', await guestKey(guestSecret(env)), new TextEncoder().encode(guestId));
  return `${guestId}.${b64u(signature)}`;
};

export const verifyGuestId = async (value: string | undefined, env: AuthEnv | undefined) => {
  if (!value) return undefined;
  const cut = value.lastIndexOf('.');
  if (cut <= 0) return undefined;
  const guestId = value.slice(0, cut);
  try {
    const signature = Uint8Array.from(atob(value.slice(cut + 1).replaceAll('-', '+').replaceAll('_', '/')), ch => ch.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', await guestKey(guestSecret(env)), signature, new TextEncoder().encode(guestId));
    return ok ? guestId : undefined;
  } catch {
    return undefined;
  }
};

export const checkOrigin = (c: Context): boolean => {
  const origin = c.req.header('origin');
  return !origin || origin === new URL(c.req.url).origin;
};

const guestCookieOptions = (c: Context) => ({
  httpOnly: true,
  secure: secure(c),
  sameSite: 'Lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
});

/** ゲスト用Cookieを確立してguestIdを返す。署名の有効な既存Cookieがあれば再利用する。 */
export async function ensureGuest(c: Context): Promise<string> {
  const existing = await verifyGuestId(getCookie(c, GUEST_COOKIE), c.env as AuthEnv | undefined);
  if (existing) return existing;
  const guestId = crypto.randomUUID();
  setCookie(c, GUEST_COOKIE, await signGuestId(guestId, c.env as AuthEnv | undefined), guestCookieOptions(c));
  return guestId;
}

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
  const guestId = await verifyGuestId(getCookie(c, GUEST_COOKIE), c.env as AuthEnv | undefined);
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
      const stateCookie = {
        httpOnly: true,
        secure: secure(c),
        sameSite: 'Lax' as const,
        path: '/',
        maxAge: 600,
      };
      setCookie(c, STATE_COOKIE, state, stateCookie);
      // ログイン後の戻り先（例: /join#<token>）。同一オリジンの相対パスのみ受け付ける
      const next = safeNext(c.req.query('next'), c.req.url);
      if (next) {
        setCookie(c, NEXT_COOKIE, next, stateCookie);
      } else {
        deleteCookie(c, NEXT_COOKIE, { path: '/' });
      }
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
        const next = getCookie(c, NEXT_COOKIE);
        deleteCookie(c, NEXT_COOKIE, { path: '/' });
        return c.redirect(safeNext(next, c.req.url) ?? '/settings', 302);
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

export const guestRoutes = new Hono<{ Bindings: AuthEnv }>()
  .post('/session', async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    await ensureGuest(c);
    return c.body(null, 204);
  });
