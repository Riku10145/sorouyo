import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { describe, expect, test, vi } from 'vitest';
import {
  GUEST_COOKIE,
  SESSION_COOKIE,
  STATE_COOKIE,
  buildAuthRoutes,
  guestRoutes,
  type AuthDeps,
  type SealedSession,
  type SessionUser,
  type WorkosClient,
} from './auth';

const user: SessionUser = { id: 'user_1', email: 'host@example.com', firstName: '主', lastName: '催' };

function fakeWorkos(overrides: {
  authUrl?: string;
  sealed?: string;
  session?: Partial<SealedSession>;
  codeFails?: boolean;
} = {}): WorkosClient {
  const session: SealedSession = {
    authenticate: vi.fn(async () => ({ authenticated: true as const, user, sessionId: 'sess_1' })),
    refresh: vi.fn(async () => ({ authenticated: true as const, user, sessionId: 'sess_1', sealedSession: 'sealed.new' })),
    getLogoutUrl: vi.fn(async () => 'https://workos.example/logout'),
    ...overrides.session,
  };
  return {
    userManagement: {
      getAuthorizationUrl: (o) => overrides.authUrl ?? `https://workos.example/authorize?state=${o.state}&redirect_uri=${encodeURIComponent(o.redirectUri)}`,
      authenticateWithCode: async (o) => {
        if (overrides.codeFails) throw new Error('bad code');
        return { sealedSession: overrides.sealed ?? 'sealed.abc', user };
      },
      loadSealedSession: () => session,
    },
  };
}

function testApp(workos: WorkosClient) {
  const deps: AuthDeps = {
    workos,
    config: {
      clientId: 'client_1',
      cookiePassword: 'x'.repeat(40),
      redirectUri: 'https://app.example/api/auth/callback',
      logoutReturnTo: 'https://app.example/',
    },
  };
  return new Hono()
    .route('/api/auth', buildAuthRoutes(() => deps))
    .route('/api/guest', guestRoutes);
}

const cookies = (res: Response, name: string) =>
  res.headers.getSetCookie().filter((v) => v.startsWith(`${name}=`));

const sessionCookie = (res: Response) =>
  res.headers.getSetCookie().find((v) => v.startsWith(`${SESSION_COOKIE}=`))?.split(';')[0] ?? '';

describe('auth', () => {
  test('login redirects to the hosted page and stores a one-time state cookie', async () => {
    const app = testApp(fakeWorkos());
    const res = await app.request('https://app.example/api/auth/login');
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toContain('https://workos.example/authorize');
    const state = new URL(location).searchParams.get('state')!;
    const cookie = cookies(res, STATE_COOKIE)[0]!;
    expect(cookie).toContain(`sorouyo_state=${state}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
  });

  test('callback without the matching state cookie is rejected', async () => {
    const app = testApp(fakeWorkos());
    const res = await app.request('https://app.example/api/auth/callback?code=c&state=wrong');
    expect(res.status).toBe(400);
  });

  test('callback seals the session into an HttpOnly cookie', async () => {
    const app = testApp(fakeWorkos());
    const login = await app.request('https://app.example/api/auth/login');
    const state = new URL(login.headers.get('location')!).searchParams.get('state')!;
    const stateCookie = cookies(login, STATE_COOKIE)[0]!.split(';')[0]!;
    const res = await app.request(`https://app.example/api/auth/callback?code=c&state=${state}`, {
      headers: { cookie: stateCookie },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/settings');
    const cookie = cookies(res, SESSION_COOKIE)[0]!;
    expect(cookie).toContain('sorouyo_session=sealed.abc');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
  });

  test('me is 401 without a session and returns the user with one', async () => {
    const app = testApp(fakeWorkos());
    expect((await app.request('https://app.example/api/auth/me')).status).toBe(401);
    const res = await app.request('https://app.example/api/auth/me', {
      headers: { cookie: `${SESSION_COOKIE}=sealed.abc` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: 'user_1', email: 'host@example.com', firstName: '主', lastName: '催' },
    });
  });

  test('me refreshes an expired session and replaces the cookie', async () => {
    const session: Partial<SealedSession> = {
      authenticate: vi.fn(async () => ({ authenticated: false as const })),
    };
    const workos = fakeWorkos({ session });
    const app = testApp(workos);
    const res = await app.request('https://app.example/api/auth/me', {
      headers: { cookie: `${SESSION_COOKIE}=sealed.old` },
    });
    expect(res.status).toBe(200);
    expect(cookies(res, SESSION_COOKIE)[0]).toContain('sorouyo_session=sealed.new');
  });

  test('logout clears the cookie and returns the hosted logout URL', async () => {
    const app = testApp(fakeWorkos());
    const res = await app.request('https://app.example/api/auth/logout', {
      method: 'POST',
      headers: {
        cookie: `${SESSION_COOKIE}=sealed.abc`,
        origin: 'https://app.example',
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ logoutUrl: 'https://workos.example/logout' });
    expect(cookies(res, SESSION_COOKIE)[0]).toContain('Max-Age=0');
  });

  test('logout rejects a cross-origin POST', async () => {
    const app = testApp(fakeWorkos());
    const res = await app.request('https://app.example/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });
});

describe('guest', () => {
  test('answer session sets a guest cookie without any login', async () => {
    const app = testApp(fakeWorkos());
    const res = await app.request('https://app.example/api/guest/session', { method: 'POST' });
    expect(res.status).toBe(204);
    const cookie = cookies(res, GUEST_COOKIE)[0]!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  test('an existing guest cookie is kept for the same browser', async () => {
    const app = testApp(fakeWorkos());
    const res = await app.request('https://app.example/api/guest/session', {
      method: 'POST',
      headers: { cookie: `${GUEST_COOKIE}=guest-1` },
    });
    expect(res.status).toBe(204);
    expect(cookies(res, GUEST_COOKIE)).toHaveLength(0);
  });
});
