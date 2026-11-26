import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { z } from 'zod';
import { validator } from 'hono/validator';
import { voteSchema } from '../shared/schema';
import { GROUP_CREATION_LIMIT } from '../shared/model';
import { can, type PollTarget, type Subject } from '../shared/permissions';
import { getCookie } from 'hono/cookie';
import {
  GUEST_COOKIE, authDeps, checkOrigin, ensureGuest, resolveUser, verifyGuestId,
  type AuthEnv, type GetAuthDeps,
} from './auth';

export interface DataEnv extends AuthEnv {
  DB: D1Database;
  ANALYTICS_TOKEN?: string;
  ANSWER_RESPONDENT_RATE_LIMIT?: RateLimit;
  ANSWER_IP_RATE_LIMIT?: RateLimit;
  ANSWER_RESPONDENT_RATE_LIMIT_PER_MINUTE?: string;
  ANSWER_IP_RATE_LIMIT_PER_MINUTE?: string;
}

type C = Context<{ Bindings: DataEnv }>;

const now = () => new Date().toISOString();

/** 回答を受け付ける条件（service-design.md: 受付中かどうかをSQLの条件に含める）。 */
const OPEN_WHERE = `status = 'open' AND reopen_pending = 0 AND (deadline_at IS NULL OR deadline_at > ?)`;

const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');

const newToken = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');

const RATE_LIMIT_MESSAGE = '少し時間をおいてもう一度お試しください';
const rateLimited = (c: C) => c.json({ error: 'rate_limited', message: RATE_LIMIT_MESSAGE } as const, 429);

const positiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

// ユニットテストなどbindingがない環境向けのフォールバック。アプリごとにカウンターを持ち、
// 独立したテスト同士が回数枠を共有しないようにする。本番・ローカルWorkerでは wrangler.jsonc の
// Rate Limiting binding が使われ、上限もそちらの simple.limit で変更する。
const makeAnswerLimiter = () => {
  const fallbackBuckets = new Map<string, { count: number; resetAt: number }>();
  const fallbackLimit = (key: string, limit: number, at = Date.now()) => {
    if (fallbackBuckets.size >= 1000) {
      for (const [bucketKey, bucket] of fallbackBuckets) if (bucket.resetAt <= at) fallbackBuckets.delete(bucketKey);
      // 期限切れだけでは減らない場合も、テスト用フォールバックがメモリを食い続けないよう最古のキーを外す
      if (fallbackBuckets.size >= 1000) fallbackBuckets.delete(fallbackBuckets.keys().next().value!);
    }
    const bucket = fallbackBuckets.get(key);
    if (!bucket || bucket.resetAt <= at) {
      fallbackBuckets.set(key, { count: 1, resetAt: at + 60_000 });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  };
  return async (
    binding: RateLimit | undefined, key: string, configuredLimit: string | undefined, fallbackDefault: number,
  ) => binding
    ? (await binding.limit({ key })).success
    : fallbackLimit(key, positiveInt(configuredLimit, fallbackDefault));
};

// 本番ではCloudflareが付けるIPを使う。ローカル/テストではヘッダが無いことがあるため、
// フォールバック制限が効くよう同一の未知送信元として扱う。
const clientIp = (c: C) => c.req.header('cf-connecting-ip')?.trim() || 'unknown';

// --- DB行 -------------------------------------------------------------------

interface GroupRow { id: string; name: string; color: string | null; created_by?: string | null }
interface MemberRow { group_id: string; user_id: string; role: 'admin' | 'member' }
interface PollRow {
  id: string; group_id: string; creator_id: string; title: string;
  deadline_at: string | null; status: 'open' | 'confirmed';
  confirmed_candidate_id: string | null; created_at: string;
  edit_version: number; reopen_pending: number;
}
interface CandidateRow { id: string; poll_id: string; position: number; date: string; start_time: string | null }
interface AnswerRow {
  id: string; poll_id: string; respondent_key: string; user_id: string | null;
  guest_id: string | null; display_name: string; comment: string | null;
  created_at: string; updated_at: string;
}
interface VoteRow { answer_id: string; candidate_id: string; value: 'yes' | 'maybe' | 'no' }
interface EventRow {
  id: string; group_id: string; date: string; start_time: string | null;
  title: string; memo: string | null; source_poll_id: string | null; created_at: string;
}
interface InviteRow {
  id: string; purpose: 'answer' | 'join'; poll_id: string | null; group_id: string | null;
  token_hash: string; expires_at: string | null; revoked_at: string | null; created_by: string | null;
  created_at: string;
}

const all = <T>(stmt: Promise<{ results: T[] }>) => stmt.then(r => r.results);
const get = <T>(stmt: Promise<T | null>) => stmt;

// --- 権限まわり -------------------------------------------------------------

type GetSubject = (c: C) => Promise<Subject>;

const makeSubjectOf = (getDeps: GetAuthDeps): GetSubject => async (c) => {
  const deps = getDeps(c as unknown as Parameters<GetAuthDeps>[0]);
  const user = deps ? await resolveUser(c, deps) : null;
  if (user) {
    await ensureUser(c, user);
    return { userId: user.id };
  }
  const guestId = await verifyGuestId(getCookie(c, GUEST_COOKIE), c.env);
  return guestId ? { guestId } : {};
};

async function ensureUser(c: C, user: { id: string; email: string; firstName?: string | null; lastName?: string | null }) {
  const email = user.email ?? null;
  const name = [user.lastName, user.firstName].filter(Boolean).join(' ') || null;
  const existing = await get<{ email: string | null; display_name: string | null }>(c.env.DB.prepare(
    `SELECT email, display_name FROM users WHERE id = ?`
  ).bind(user.id).first());
  // メール・表示名に変化がなければ書き込まない（認証済みリクエストごとのupsertを避ける）
  if (existing && existing.email === email && existing.display_name === name) return;
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, updated_at = excluded.updated_at`
  ).bind(user.id, email, name, now(), now()).run();
}

/** 調整の作成者・メンバー・管理者をまとめて PollTarget にする。 */
async function pollTarget(c: C, poll: PollRow, inviteValid: boolean): Promise<PollTarget> {
  const members = await all<MemberRow>(c.env.DB.prepare(
    `SELECT group_id, user_id, role FROM memberships WHERE group_id = ?`
  ).bind(poll.group_id).all());
  return {
    creatorId: poll.creator_id,
    memberIds: members.map(m => m.user_id),
    adminIds: members.filter(m => m.role === 'admin').map(m => m.user_id),
    inviteValid,
  };
}

const memberRole = async (c: C, groupId: string, userId: string) =>
  (await get<{ role: 'admin' | 'member' }>(c.env.DB.prepare(
    `SELECT role FROM memberships WHERE group_id = ? AND user_id = ?`
  ).bind(groupId, userId).first()))?.role;

const JOIN_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 期限列がない参加リンクは、移行後も旧Workerで発行されたものとして発行時刻から7日後を期限に使う。 */
const joinInviteExpiresAt = (invite: Pick<InviteRow, 'created_at' | 'expires_at'>) =>
  invite.expires_at ?? new Date(Date.parse(invite.created_at) + JOIN_INVITE_TTL_MS).toISOString();

const findInvite = async (c: C, token: string) => {
  const hash = await sha256(token);
  const invite = await get<InviteRow>(c.env.DB.prepare(
    `SELECT id, purpose, poll_id, group_id, token_hash, expires_at, revoked_at, created_by, created_at FROM invites WHERE token_hash = ?`
  ).bind(hash).first());
  if (!invite || invite.revoked_at) return undefined;
  const expired = invite.purpose === 'join'
    ? joinInviteExpiresAt(invite) <= now()
    : invite.expires_at && invite.expires_at <= now();
  if (expired) return undefined;
  return invite;
};

const newAnswerInvite = async (c: C, pollId: string, createdBy?: string) => {
  const token = newToken();
  await c.env.DB.prepare(
    `INSERT INTO invites (id, purpose, poll_id, token_hash, created_by, created_at) VALUES (?, 'answer', ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), pollId, await sha256(token), createdBy ?? null, now()).run();
  return token;
};

// --- 計測（#20） -------------------------------------------------------------

const analyticsDay = (timestamp = Date.now()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(timestamp));

/** 匿名の訪問者Cookieだけを使い、表示名・予定名・コメント・リンク秘密部分を残さない。 */
type AnalyticsEventType = 'invite_visit' | 'answer_submit' | 'usage_start_click' | 'usage_start';

async function recordAnalytics(
  c: C, eventType: AnalyticsEventType, inviteId: string | null, pollId: string | null, visitorId: string,
) {
  // 計測の失敗で本体の回答・閲覧・グループ作成を失敗させない
  const at = now();
  try {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO analytics_events
       (id, event_type, visitor_id, invite_id, poll_id, occurred_on, created_at, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(), eventType, visitorId, inviteId, pollId,
      analyticsDay(), at, `${eventType}:${inviteId ?? 'none'}:${visitorId}`,
    ).run();
  } catch {
    console.warn('analytics event write failed');
  }
}

/** ゲスト回答後に初めて自分のグループを作った利用開始を、同じ匿名訪問者IDで記録する。 */
async function recordUsageStart(c: C, visitorId: string) {
  try {
    const source = await get<{ invite_id: string | null; poll_id: string | null }>(c.env.DB.prepare(
      `SELECT invite_id, poll_id FROM analytics_events
       WHERE visitor_id = ? AND event_type IN ('usage_start_click', 'answer_submit')
       ORDER BY created_at DESC, rowid DESC LIMIT 1`
    ).bind(visitorId).first());
    if (!source?.invite_id || !source.poll_id) return;
    await recordAnalytics(c, 'usage_start', source.invite_id, source.poll_id, visitorId);
  } catch {
    console.warn('usage start lookup failed');
  }
}

const joinInviteState = (invite: Pick<InviteRow, 'created_at' | 'expires_at' | 'revoked_at'>, at = now()) => {
  if (invite.revoked_at) return 'revoked' as const;
  if (joinInviteExpiresAt(invite) <= at) return 'expired' as const;
  return 'active' as const;
};

const presentJoinInvite = (invite: InviteRow) => ({
  id: invite.id,
  createdAt: invite.created_at,
  expiresAt: joinInviteExpiresAt(invite),
  state: joinInviteState(invite),
} as const);

const latestJoinInvite = async (c: C, groupId: string) => get<InviteRow>(c.env.DB.prepare(
  `SELECT id, purpose, poll_id, group_id, token_hash, expires_at, revoked_at, created_by, created_at
   FROM invites WHERE purpose = 'join' AND group_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
).bind(groupId).first());

/** 参加リンクはグループごと1本だけ有効にするため、旧リンクの失効と新リンクの作成を同一バッチで行う。 */
const reissueJoinInvite = async (c: C, groupId: string, createdBy: string) => {
  const token = newToken();
  const id = crypto.randomUUID();
  const createdAtMs = Date.now();
  const createdAt = new Date(createdAtMs).toISOString();
  const expiresAt = new Date(createdAtMs + JOIN_INVITE_TTL_MS).toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE invites SET revoked_at = ? WHERE purpose = 'join' AND group_id = ? AND revoked_at IS NULL`)
      .bind(createdAt, groupId),
    c.env.DB.prepare(
      `INSERT INTO invites (id, purpose, group_id, token_hash, expires_at, created_by, created_at) VALUES (?, 'join', ?, ?, ?, ?, ?)`
    ).bind(id, groupId, await sha256(token), expiresAt, createdBy, createdAt),
  ]);
  return { token, invite: { id, createdAt, expiresAt, state: 'active' as const } };
};

// --- 回答の書き込み ----------------------------------------------------------

/** 回答行の作成・更新と各票の差し替えを、受付中であることをSQL条件に含めて同一バッチで行う。 */
async function writeAnswer(
  c: C, pollId: string, key: string, ids: { userId?: string; guestId?: string },
  name: string, comment: string | null, votes: { candidateId: string; value: string }[],
) {
  const answerId = crypto.randomUUID();
  const at = now();
  const candidateIds = [...new Set(votes.map(vote => vote.candidateId))];
  const candidateGuard = candidateIds.length
    ? `(SELECT COUNT(DISTINCT id) FROM candidates WHERE poll_id = ? AND id IN (${candidateIds.map(() => '?').join(',')})) = ${candidateIds.length}`
    : '1 = 1';
  const guardBinds = candidateIds.length ? [pollId, ...candidateIds] : [];
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO answers (id, poll_id, respondent_key, user_id, guest_id, display_name, comment, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM polls WHERE id = ? AND ${OPEN_WHERE}) AND (${candidateGuard})
       ON CONFLICT (poll_id, respondent_key) DO UPDATE SET
         display_name = excluded.display_name, comment = excluded.comment, updated_at = excluded.updated_at
       WHERE EXISTS (SELECT 1 FROM polls WHERE id = excluded.poll_id AND ${OPEN_WHERE})`
    ).bind(answerId, pollId, key, ids.userId ?? null, ids.guestId ?? null, name, comment, at, at, pollId, at, ...guardBinds, at),
    c.env.DB.prepare(
      `DELETE FROM votes WHERE answer_id = (SELECT id FROM answers WHERE poll_id = ? AND respondent_key = ?)
       AND EXISTS (SELECT 1 FROM polls WHERE id = ? AND ${OPEN_WHERE}) AND (${candidateGuard})`
    ).bind(pollId, key, pollId, at, ...guardBinds),
    // 回答書き込みで調整の版を進め、開いていた編集画面が新しい票を見落としたまま保存しないようにする
    c.env.DB.prepare(
      `UPDATE polls SET edit_version = edit_version + 1 WHERE id = ? AND ${OPEN_WHERE} AND (${candidateGuard})`
    ).bind(pollId, at, ...guardBinds),
  ];
  for (const vote of votes) {
    stmts.push(c.env.DB.prepare(
      `INSERT INTO votes (answer_id, candidate_id, value)
       SELECT (SELECT id FROM answers WHERE poll_id = ? AND respondent_key = ?), c.id, ?
       FROM candidates c JOIN polls p ON p.id = c.poll_id
       WHERE c.id = ? AND c.poll_id = ? AND p.${OPEN_WHERE} AND (${candidateGuard})`
    ).bind(pollId, key, vote.value, vote.candidateId, pollId, at, ...guardBinds));
  }
  const results = await c.env.DB.batch(stmts);
  const wrote = !!results[0]?.meta?.changes && !!results[2]?.meta?.changes;
  const saved = await get<AnswerRow>(c.env.DB.prepare(
    `SELECT * FROM answers WHERE poll_id = ? AND respondent_key = ?`
  ).bind(pollId, key).first());
  const savedVotes = await all<VoteRow>(c.env.DB.prepare(
    `SELECT v.* FROM votes v JOIN answers a ON a.id = v.answer_id WHERE a.poll_id = ? AND a.respondent_key = ?`
  ).bind(pollId, key).all());
  // 受付中でないと条件付き書き込みは0行になり、 saved には古い行が残る。受付判定は呼び出し側で行う
  return { wrote, saved: saved ?? null, savedVotes };
}

// --- バリデーション ----------------------------------------------------------

// グループ色は16進カラーコード。画面はパレットから選ぶ
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const createGroupBody = z.object({ name: z.string().trim().min(1).max(40), color: colorSchema.nullish() });
const joinBody = z.object({ token: z.string().min(1) });
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const createPollBody = z.object({
  title: z.string().trim().min(1).max(60),
  deadlineAt: z.iso.datetime().nullish(),
  candidates: z.array(z.object({ date: z.iso.date(), time: timeSchema.nullish() })).min(1).max(31),
});
const inviteBody = z.object({ token: z.string().min(1) });
const answerBody = z.object({
  token: z.string().min(1),
  name: z.string().trim().min(1).max(30),
  comment: z.string().trim().max(100).nullish(),
  votes: z.array(z.object({ candidateId: z.string().min(1), value: voteSchema })).max(50),
});
const confirmBody = z.object({ candidateId: z.string().min(1) });
const notificationSettingsBody = z.object({ enabled: z.boolean(), time: timeSchema });
const unconfirmBody = z.object({ eventId: z.string().min(1) });
const eventBody = z.object({
  date: z.iso.date(), time: timeSchema.nullish(), title: z.string().trim().min(1).max(60), memo: z.string().trim().max(500).nullish(),
});
const candidateInput = z.object({ id: z.string().min(1).optional(), date: z.iso.date(), time: timeSchema.nullish() });
const updatePollBody = z.object({
  editVersion: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(60),
  deadlineAt: z.iso.datetime().nullish(),
  candidates: z.array(candidateInput).min(1).max(31),
});
const monthQuery = /^\d{4}-\d{2}$/;

const json = <T extends z.ZodType>(schema: T) =>
  validator('json', (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return c.json({ error: 'invalid_body' } as const, 400);
    return parsed.data;
  });

// --- ルート -----------------------------------------------------------------

export function buildDataRoutes(getDeps: GetAuthDeps) {
  const subjectOf = makeSubjectOf(getDeps);
  const limitAnswer = makeAnswerLimiter();
  /** 送信元IP制限は入力検証より先に行い、不正な本文の連投もカウントする。 */
  const limitAnswerIp = async (c: C, next: Next) => {
    if (!await limitAnswer(
      c.env.ANSWER_IP_RATE_LIMIT,
      `answer-ip:${clientIp(c)}`,
      c.env.ANSWER_IP_RATE_LIMIT_PER_MINUTE,
      60,
    )) return rateLimited(c);
    await next();
  };
  return new Hono<{ Bindings: DataEnv }>()

  // ログイン中の利用者が所属するグループ一覧（別ブラウザでも同じ結果が返る）
  .get('/groups', async (c) => {
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groups = await all<GroupRow & { role: string }>(c.env.DB.prepare(
      `SELECT g.id, g.name, g.color, m.role FROM memberships m JOIN groups g ON g.id = m.group_id
       WHERE m.user_id = ? ORDER BY g.created_at`
    ).bind(subject.userId).all());
    return c.json({ groups } as const);
  })

  // グループ作成。作成者はadminとして所属する。上限判定と挿入は1つのSQLにし、同時送信でも上限を超えないようにする
  .post('/groups', json(createGroupBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const body = { data: c.req.valid('json') };
    const id = crypto.randomUUID();
    const at = now();
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO groups (id, name, color, created_by, created_at)
         SELECT ?, ?, ?, ?, ?
         WHERE (
           SELECT COUNT(*) FROM groups WHERE created_by = ?
         ) + (
           SELECT COUNT(*) FROM groups AS g
           WHERE g.created_by IS NULL AND (
             SELECT m.user_id FROM memberships AS m
             WHERE m.group_id = g.id AND m.role = 'admin'
             ORDER BY m.created_at, m.user_id
             LIMIT 1
           ) = ?
         ) < ?`
      ).bind(id, body.data.name, body.data.color ?? null, subject.userId, at, subject.userId, subject.userId, GROUP_CREATION_LIMIT),
      c.env.DB.prepare(
        `INSERT INTO memberships (group_id, user_id, role, created_at)
         SELECT ?, ?, 'admin', ? WHERE EXISTS (SELECT 1 FROM groups WHERE id = ?)`
      ).bind(id, subject.userId, at, id),
    ]);
    if (!results[0]?.meta?.changes) return c.json({ error: 'group_limit' } as const, 409);
    const guestId = await verifyGuestId(getCookie(c, GUEST_COOKIE), c.env);
    if (guestId) {
      const createdCount = await get<{ n: number }>(c.env.DB.prepare(
        `SELECT (
           SELECT COUNT(*) FROM groups WHERE created_by = ?
         ) + (
           SELECT COUNT(*) FROM groups AS g
           WHERE g.created_by IS NULL AND (
             SELECT m.user_id FROM memberships AS m
             WHERE m.group_id = g.id AND m.role = 'admin'
             ORDER BY m.created_at, m.user_id
             LIMIT 1
           ) = ?
         ) AS n`
      ).bind(subject.userId, subject.userId).first());
      if (createdCount?.n === 1) await recordUsageStart(c, guestId);
    }
    return c.json({ group: { id, name: body.data.name, color: body.data.color ?? null, role: 'admin' } } as const, 201);
  })

  // グループ参加用リンクの発行・再発行（adminのみ）。有効なリンクは1本だけで、7日で期限切れになる
  .post('/groups/:id/invites', async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    if ((await memberRole(c, groupId, subject.userId)) !== 'admin') {
      return c.json({ error: 'forbidden' } as const, 403);
    }
    const { token, invite } = await reissueJoinInvite(c, groupId, subject.userId);
    return c.json({ token, invite } as const, 201);
  })

  // 参加リンクの無効化（adminのみ）。トークンではなく invitation id を指定し、リンク漏洩時に即座に止められるようにする
  .post('/groups/:id/invites/:inviteId/revoke', async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    if ((await memberRole(c, groupId, subject.userId)) !== 'admin') {
      return c.json({ error: 'forbidden' } as const, 403);
    }
    const invite = await get<InviteRow>(c.env.DB.prepare(
      `SELECT id, purpose, poll_id, group_id, token_hash, expires_at, revoked_at, created_by, created_at
       FROM invites WHERE id = ? AND purpose = 'join' AND group_id = ?`
    ).bind(c.req.param('inviteId'), groupId).first());
    if (!invite) return c.json({ error: 'not_found' } as const, 404);
    const revokedAt = invite.revoked_at ?? now();
    if (!invite.revoked_at) {
      await c.env.DB.prepare(`UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).bind(revokedAt, invite.id).run();
    }
    return c.json({ invite: presentJoinInvite({ ...invite, revoked_at: revokedAt }) } as const, 200);
  })

  // 参加リンクのプレビュー。リンクを持つ人にグループ名・招待元・参加すると見える情報だけを出す
  .post('/groups/join/preview', json(joinBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const body = { data: c.req.valid('json') };
    const invite = await findInvite(c, body.data.token);
    if (!invite || invite.purpose !== 'join' || !invite.group_id) {
      return c.json({ error: 'invite_invalid' } as const, 404);
    }
    const group = await get<GroupRow>(c.env.DB.prepare(`SELECT id, name, color FROM groups WHERE id = ?`).bind(invite.group_id).first());
    if (!group) return c.json({ error: 'invite_invalid' } as const, 404);
    const subject = await subjectOf(c);
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
    const [inviter, memberCount, upcoming] = await Promise.all([
      invite.created_by
        ? get<{ display_name: string | null }>(c.env.DB.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(invite.created_by).first())
        : Promise.resolve(null),
      get<{ n: number }>(c.env.DB.prepare(`SELECT COUNT(*) AS n FROM memberships WHERE group_id = ?`).bind(invite.group_id).first()),
      all<{ date: string; title: string }>(c.env.DB.prepare(
        `SELECT date, title FROM events WHERE group_id = ? AND date >= ? ORDER BY date, start_time LIMIT 3`
      ).bind(invite.group_id, today).all()),
    ]);
    const member = subject.userId ? (await memberRole(c, invite.group_id, subject.userId)) !== undefined : false;
    return c.json({
      group,
      inviterName: inviter?.display_name ?? null,
      memberCount: memberCount?.n ?? 0,
      upcoming,
      member,
    } as const);
  })

  // 参加リンクでログイン済み利用者が明示的に「参加」して所属を作る。再参加は冪等（役割は変えない）
  .post('/groups/join', json(joinBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const body = { data: c.req.valid('json') };
    const invite = await findInvite(c, body.data.token);
    if (!invite || invite.purpose !== 'join' || !invite.group_id) {
      return c.json({ error: 'invite_invalid' } as const, 404);
    }
    const group = await get<GroupRow>(c.env.DB.prepare(`SELECT id, name, color FROM groups WHERE id = ?`).bind(invite.group_id).first());
    if (!group) return c.json({ error: 'invite_invalid' } as const, 404);
    const existing = await memberRole(c, invite.group_id, subject.userId);
    if (!existing) {
      await c.env.DB.prepare(
        `INSERT INTO memberships (group_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)
         ON CONFLICT (group_id, user_id) DO NOTHING`
      ).bind(invite.group_id, subject.userId, now()).run();
    }
    return c.json({ group: { ...group, role: existing ?? 'member' }, already: existing !== undefined } as const, existing ? 200 : 201);
  })

  // グループ詳細（メンバー以上）。メンバー一覧と、削除確認に出す件数を含める
  .get('/groups/:id', async (c) => {
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    const role = await memberRole(c, groupId, subject.userId);
    if (!role) return c.json({ error: 'forbidden' } as const, 403);
    const group = await get<GroupRow>(c.env.DB.prepare(`SELECT id, name, color FROM groups WHERE id = ?`).bind(groupId).first());
    if (!group) return c.json({ error: 'not_found' } as const, 404);
    const [members, counts, joinInvite] = await Promise.all([
      all<{ user_id: string; display_name: string | null; email: string | null; role: 'admin' | 'member' }>(c.env.DB.prepare(
        `SELECT m.user_id, u.display_name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.group_id = ? ORDER BY m.created_at`
      ).bind(groupId).all()),
      get<{ events: number; polls: number }>(c.env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM events WHERE group_id = ?) AS events,
                (SELECT COUNT(*) FROM polls WHERE group_id = ?) AS polls`
      ).bind(groupId, groupId).first()),
      latestJoinInvite(c, groupId),
    ]);
    return c.json({
      group: { ...group, role },
      members: members.map(m => ({ id: m.user_id, name: m.display_name ?? m.email ?? '名無し', role: m.role, you: m.user_id === subject.userId })),
      counts: { events: counts?.events ?? 0, polls: counts?.polls ?? 0, members: members.length },
      joinInvite: role === 'admin' && joinInvite ? presentJoinInvite(joinInvite) : null,
    } as const);
  })

  // グループの名前・色の変更（管理者のみ）
  .patch('/groups/:id', json(createGroupBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    if ((await memberRole(c, groupId, subject.userId)) !== 'admin') {
      return c.json({ error: 'forbidden' } as const, 403);
    }
    const body = { data: c.req.valid('json') };
    const result = await c.env.DB.prepare(`UPDATE groups SET name = ?, color = ? WHERE id = ?`)
      .bind(body.data.name, body.data.color ?? null, groupId).run();
    if (!result.meta.changes) return c.json({ error: 'not_found' } as const, 404);
    return c.json({ group: { id: groupId, name: body.data.name, color: body.data.color ?? null, role: 'admin' } } as const);
  })

  // グループの削除（管理者のみ）。所属・予定・調整・候補・回答・票・招待を同一バッチで消す
  .delete('/groups/:id', async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    if ((await memberRole(c, groupId, subject.userId)) !== 'admin') {
      return c.json({ error: 'forbidden' } as const, 403);
    }
    const inPolls = `SELECT id FROM polls WHERE group_id = ?`;
    const inAnswers = `SELECT id FROM answers WHERE poll_id IN (${inPolls})`;
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM votes WHERE answer_id IN (${inAnswers})`).bind(groupId),
      c.env.DB.prepare(`DELETE FROM answers WHERE poll_id IN (${inPolls})`).bind(groupId),
      c.env.DB.prepare(`DELETE FROM candidates WHERE poll_id IN (${inPolls})`).bind(groupId),
      c.env.DB.prepare(`DELETE FROM invites WHERE group_id = ? OR poll_id IN (${inPolls})`).bind(groupId, groupId),
      c.env.DB.prepare(`DELETE FROM events WHERE group_id = ?`).bind(groupId),
      c.env.DB.prepare(`DELETE FROM polls WHERE group_id = ?`).bind(groupId),
      c.env.DB.prepare(`DELETE FROM memberships WHERE group_id = ?`).bind(groupId),
      c.env.DB.prepare(`DELETE FROM groups WHERE id = ?`).bind(groupId),
    ]);
    return c.body(null, 204);
  })

  // 予定の詳細（所属メンバーのみ）
  .get('/events/:id', async (c) => {
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const event = await get<EventRow & { group_name: string; group_color: string | null }>(c.env.DB.prepare(
      `SELECT e.*, g.name AS group_name, g.color AS group_color FROM events e JOIN groups g ON g.id = e.group_id WHERE e.id = ?`
    ).bind(c.req.param('id')).first());
    if (!event) return c.json({ error: 'not_found' } as const, 404);
    if (!(await memberRole(c, event.group_id, subject.userId))) return c.json({ error: 'forbidden' } as const, 403);
    return c.json({
      event: {
        id: event.id, date: event.date, startTime: event.start_time, title: event.title, memo: event.memo,
        group: { id: event.group_id, name: event.group_name, color: event.group_color },
        sourcePollId: event.source_poll_id,
      },
    } as const);
  })

  // 予定の編集（所属メンバー）。調整から作られた予定はタイトルとメモだけ直接編集できる
  .patch('/events/:id', json(eventBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const event = await get<EventRow>(c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(c.req.param('id')).first());
    if (!event) return c.json({ error: 'not_found' } as const, 404);
    if (!(await memberRole(c, event.group_id, subject.userId))) return c.json({ error: 'forbidden' } as const, 403);
    const body = { data: c.req.valid('json') };
    const sourced = event.source_poll_id !== null;
    const date = sourced ? event.date : body.data.date;
    const time = sourced ? event.start_time : body.data.time ?? null;
    const result = await c.env.DB.prepare(
      `UPDATE events SET title = ?, memo = ?, date = ?, start_time = ? WHERE id = ?`
    ).bind(body.data.title, body.data.memo ?? null, date, time, event.id).run();
    if (!result.meta.changes) return c.json({ error: 'not_found' } as const, 404);
    return c.json({ event: { id: event.id } } as const);
  })

  // 通常予定の削除（所属メンバー）。調整から作られた予定は確定取消で消す
  .delete('/events/:id', async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const event = await get<EventRow>(c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(c.req.param('id')).first());
    if (!event) return c.json({ error: 'not_found' } as const, 404);
    if (!(await memberRole(c, event.group_id, subject.userId))) return c.json({ error: 'forbidden' } as const, 403);
    if (event.source_poll_id) return c.json({ error: 'poll_event' } as const, 409);
    await c.env.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(event.id).run();
    return c.body(null, 204);
  })

  // 調整の作成（メンバー以上）。回答リンクを発行し、トークンはこのレスポンスにだけ含める
  .post('/groups/:id/polls', json(createPollBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    const role = await memberRole(c, groupId, subject.userId);
    if (!role) return c.json({ error: 'forbidden' } as const, 403);
    const body = { data: c.req.valid('json') };
    const pollId = crypto.randomUUID();
    const token = newToken();
    const stmts = [
      c.env.DB.prepare(
        `INSERT INTO polls (id, group_id, creator_id, title, deadline_at, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)`
      // 締切はミリ秒つきISOに正規化して保存し、 OPEN_WHERE の文字列比較と形式を揃える
      ).bind(pollId, groupId, subject.userId, body.data.title, body.data.deadlineAt ? new Date(body.data.deadlineAt).toISOString() : null, now()),
      ...body.data.candidates.map((cand, i) =>
        c.env.DB.prepare(`INSERT INTO candidates (id, poll_id, position, date, start_time) VALUES (?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), pollId, i, cand.date, cand.time ?? null)),
      c.env.DB.prepare(`INSERT INTO invites (id, purpose, poll_id, token_hash, created_by, created_at) VALUES (?, 'answer', ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), pollId, await sha256(token), subject.userId, now()),
    ];
    await c.env.DB.batch(stmts);
    return c.json({ poll: { id: pollId }, token } as const, 201);
  })

  // 回答リンクの再発行（メンバー以上）。漏えい時に使えるよう、旧リンクは同一バッチで失効させる
  .post('/polls/:id/invite', async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const poll = await get<PollRow>(c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(c.req.param('id')).first());
    if (!poll) return c.json({ error: 'not_found' } as const, 404);
    if (!(await memberRole(c, poll.group_id, subject.userId))) return c.json({ error: 'forbidden' } as const, 403);
    // 回答リンクはベアラートークン。再発行で既存リンクを失効させると、
    // 主催がコピーするたびに共有済みリンクが死ぬため、旧リンクはそのまま有効にしておく
    const token = await newAnswerInvite(c, poll.id, subject.userId);
    return c.json({ token } as const, 201);
  })

  // 所属グループの調整一覧（メンバー以上）。状態・候補数・回答数・確定日を含める
  .get('/polls', async (c) => {
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const polls = await all<PollRow & { group_name: string; group_color: string | null; candidate_count: number; answer_count: number; confirmed_date: string | null; confirmed_time: string | null }>(c.env.DB.prepare(
      `SELECT p.*, g.name AS group_name, g.color AS group_color, cc.date AS confirmed_date, cc.start_time AS confirmed_time,
              (SELECT COUNT(*) FROM candidates cd WHERE cd.poll_id = p.id) AS candidate_count,
              (SELECT COUNT(DISTINCT v.answer_id) FROM votes v JOIN answers a ON a.id = v.answer_id WHERE a.poll_id = p.id) AS answer_count
       FROM polls p
       JOIN groups g ON g.id = p.group_id
       JOIN memberships m ON m.group_id = p.group_id AND m.user_id = ?
       LEFT JOIN candidates cc ON cc.id = p.confirmed_candidate_id
       ORDER BY p.created_at DESC`
    ).bind(subject.userId).all());
    const at = now();
    return c.json({
      polls: polls.map(p => ({
        id: p.id,
        title: p.title,
        status: p.status,
        deadlineAt: p.deadline_at,
        accepting: p.status === 'open' && !p.reopen_pending && (!p.deadline_at || p.deadline_at > at),
        group: { id: p.group_id, name: p.group_name, color: p.group_color },
        creator: p.creator_id === subject.userId,
        candidatesCount: p.candidate_count,
        answersCount: p.answer_count,
        confirmed: p.confirmed_date ? { date: p.confirmed_date, startTime: p.confirmed_time } : null,
      })),
    } as const);
  })

  // 調整の取得（メンバー以上）。ゲストの回答リンクではこの形は返さない。確定候補と予定IDは1つの読み取りで取り、再確定の途中でずれないようにする
  .get('/polls/:id', async (c) => {
    const subject = await subjectOf(c);
    // 未ログインは401としてクライアントにログイン導線を出させる（ゲストは回答リンク経由のみ）
    if (!subject.userId) return c.json({ error: 'unauthorized' } as const, 401);
    const poll = await get<PollRow & { confirmed_event_id: string | null }>(c.env.DB.prepare(
      `SELECT p.*, (SELECT e.id FROM events e WHERE e.source_poll_id = p.id) AS confirmed_event_id FROM polls p WHERE p.id = ?`
    ).bind(c.req.param('id')).first());
    if (!poll) return c.json({ error: 'not_found' } as const, 404);
    const target = await pollTarget(c, poll, false);
    if (!can(subject, 'viewTally', target) && !can(subject, 'viewPoll', target)) {
      return c.json({ error: 'forbidden' } as const, 403);
    }
    const myKey = subject.userId ? `u:${subject.userId}` : undefined;
    const tallyAllowed = can(subject, 'viewTally', target);
    const [group, candidates, answers, votes, host, memberRows] = await Promise.all([
      get<GroupRow>(c.env.DB.prepare(`SELECT id, name, color FROM groups WHERE id = ?`).bind(poll.group_id).first()),
      all<CandidateRow>(c.env.DB.prepare(`SELECT * FROM candidates WHERE poll_id = ? ORDER BY position`).bind(poll.id).all()),
      all<AnswerRow>(c.env.DB.prepare(`SELECT * FROM answers WHERE poll_id = ? ORDER BY created_at`).bind(poll.id).all()),
      all<VoteRow & { respondent_key: string }>(c.env.DB.prepare(
        `SELECT v.*, a.respondent_key FROM votes v JOIN answers a ON a.id = v.answer_id WHERE a.poll_id = ?`
      ).bind(poll.id).all()),
      get<{ display_name: string | null }>(c.env.DB.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(poll.creator_id).first()),
      // 催促対象の分け方（#7）は作成者だけに返す。メンバー一覧はゲスト・一般メンバーに出さない
      tallyAllowed
        ? all<{ user_id: string; display_name: string | null; email: string | null; answered: number }>(c.env.DB.prepare(
            `SELECT m.user_id, u.display_name, u.email,
                    EXISTS(SELECT 1 FROM answers a WHERE a.poll_id = ? AND a.respondent_key = 'u:' || m.user_id) AS answered
             FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY m.created_at`
          ).bind(poll.id, poll.group_id).all())
        : Promise.resolve([]),
    ]);
    const votesBy = new Map<string, Record<string, string>>();
    for (const v of votes) {
      let entry = votesBy.get(v.respondent_key);
      if (!entry) votesBy.set(v.respondent_key, entry = {});
      entry[v.candidate_id] = v.value;
    }
    return c.json({
      poll: {
        id: poll.id,
        title: poll.title,
        status: poll.status,
        deadlineAt: poll.deadline_at,
        confirmedCandidateId: poll.confirmed_candidate_id,
        confirmedEventId: poll.confirmed_event_id,
        editVersion: poll.edit_version,
        reopenPending: poll.reopen_pending === 1,
        group: group!,
        creatorId: poll.creator_id,
        hostName: host?.display_name ?? null,
        candidates: candidates.map(cand => ({ id: cand.id, date: cand.date, startTime: cand.start_time })),
        // 集計（回答者別の内訳）は作成者のみ。メンバーは自分の回答まで
        answers: answers.filter(a => tallyAllowed || a.respondent_key === myKey).map(a => ({
          id: a.id,
          name: a.display_name,
          comment: a.comment,
          own: a.respondent_key === myKey,
          votes: votesBy.get(a.respondent_key) ?? {},
          createdAt: a.created_at,
        })),
        // #7: 催促対象の分類。作成者にだけ返し、回答済みかどうかを回答行の有無で判定する
        members: memberRows.map(m => ({
          id: m.user_id,
          name: m.display_name ?? m.email ?? '名無し',
          answered: Boolean(m.answered),
        })),
      },
    } as const);
  })

  // 受付中の調整の編集（作成者のみ）。候補の日時変更は削除＋追加扱いで、その候補の票だけ消す
  .patch('/polls/:id', json(updatePollBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const poll = await get<PollRow>(c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(c.req.param('id')).first());
    if (!poll) return c.json({ error: 'not_found' } as const, 404);
    const target = await pollTarget(c, poll, false);
    if (!can(subject, 'editPoll', target)) return c.json({ error: 'forbidden' } as const, 403);
    if (poll.status !== 'open') return c.json({ error: 'already_confirmed' } as const, 409);
    const body = { data: c.req.valid('json') };
    const current = await all<CandidateRow>(c.env.DB.prepare(`SELECT * FROM candidates WHERE poll_id = ? ORDER BY position`).bind(poll.id).all());
    const currentById = new Map(current.map(row => [row.id, row]));
    const used = new Set<string>();
    const rows = body.data.candidates.map((input, index) => {
      const existing = input.id && !used.has(input.id) ? currentById.get(input.id) : undefined;
      const unchanged = existing && existing.date === input.date && (existing.start_time ?? null) === (input.time ?? null);
      const id = unchanged ? existing.id : crypto.randomUUID();
      used.add(id);
      return { id, position: index, date: input.date, time: input.time ?? null, unchanged: !!unchanged };
    });
    if (new Set(rows.map(row => `${row.date}\0${row.time ?? ''}`)).size !== rows.length) {
      return c.json({ error: 'invalid_body' } as const, 400);
    }
    const kept = new Set(rows.filter(row => row.unchanged).map(row => row.id));
    const removed = current.filter(row => !kept.has(row.id)).map(row => row.id);
    const deadlineAt = body.data.deadlineAt ? new Date(body.data.deadlineAt).toISOString() : null;
    const clearsReopen = deadlineAt !== null && new Date(deadlineAt).getTime() > Date.now();
    // 確定取消からの再調整では、未来の締切を保存するまで受付を再開しない。空欄や過去時刻のまま成功にはしない
    if (poll.reopen_pending && !clearsReopen) return c.json({ error: 'reopen_deadline_required' } as const, 400);
    const version = body.data.editVersion;
    const editGuard = `EXISTS (SELECT 1 FROM polls WHERE id = ? AND status = 'open' AND edit_version = ?)`;
    const stmts = [
      c.env.DB.prepare(
        `UPDATE polls SET title = ?, deadline_at = ?, reopen_pending = ?
         WHERE id = ? AND status = 'open' AND edit_version = ?`
      ).bind(body.data.title, deadlineAt, clearsReopen ? 0 : poll.reopen_pending, poll.id, version),
      // UNIQUE(poll_id, position) の即時制約を避けるため、再配置の間は既存候補を一時的に大きな位置へ退避する
      ...current.map(row => c.env.DB.prepare(`UPDATE candidates SET position = ? WHERE id = ? AND ${editGuard}`)
        .bind(row.position + 1000, row.id, poll.id, version)),
      ...removed.map(id => c.env.DB.prepare(`DELETE FROM votes WHERE candidate_id = ? AND ${editGuard}`)
        .bind(id, poll.id, version)),
      ...removed.map(id => c.env.DB.prepare(`DELETE FROM candidates WHERE id = ? AND ${editGuard}`)
        .bind(id, poll.id, version)),
      ...rows.filter(row => !row.unchanged).map(row => c.env.DB.prepare(
        `INSERT INTO candidates (id, poll_id, position, date, start_time) SELECT ?, ?, ?, ?, ? WHERE ${editGuard}`
      ).bind(row.id, poll.id, row.position, row.date, row.time, poll.id, version)),
      ...rows.filter(row => row.unchanged).map(row => c.env.DB.prepare(`UPDATE candidates SET position = ? WHERE id = ? AND ${editGuard}`)
        .bind(row.position, row.id, poll.id, version)),
      c.env.DB.prepare(`UPDATE polls SET edit_version = edit_version + 1 WHERE id = ? AND status = 'open' AND edit_version = ?`)
        .bind(poll.id, version),
    ];
    const results = await c.env.DB.batch(stmts);
    if (!results[results.length - 1]!.meta.changes) return c.json({ error: 'conflict' } as const, 409);
    return c.json({ poll: { id: poll.id, status: 'open' } } as const);
  })

  // 受付中の調整の削除（作成者のみ）。確定済みは先に確定取消を求める
  .delete('/polls/:id', async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const poll = await get<PollRow>(c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(c.req.param('id')).first());
    if (!poll) return c.json({ error: 'not_found' } as const, 404);
    const target = await pollTarget(c, poll, false);
    if (!can(subject, 'editPoll', target)) return c.json({ error: 'forbidden' } as const, 403);
    if (poll.status !== 'open') return c.json({ error: 'already_confirmed' } as const, 409);
    const inAnswers = `SELECT id FROM answers WHERE poll_id = ?`;
    const openPoll = `EXISTS (SELECT 1 FROM polls WHERE id = ? AND status = 'open')`;
    const results = await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM votes WHERE (answer_id IN (${inAnswers}) OR candidate_id IN (SELECT id FROM candidates WHERE poll_id = ?)) AND ${openPoll}`).bind(poll.id, poll.id, poll.id),
      c.env.DB.prepare(`DELETE FROM answers WHERE poll_id = ? AND ${openPoll}`).bind(poll.id, poll.id),
      c.env.DB.prepare(`DELETE FROM candidates WHERE poll_id = ? AND ${openPoll}`).bind(poll.id, poll.id),
      c.env.DB.prepare(`DELETE FROM invites WHERE poll_id = ? AND ${openPoll}`).bind(poll.id, poll.id),
      c.env.DB.prepare(`DELETE FROM events WHERE source_poll_id = ? AND ${openPoll}`).bind(poll.id, poll.id),
      c.env.DB.prepare(`DELETE FROM polls WHERE id = ? AND status = 'open'`).bind(poll.id),
    ]);
    if (!results[results.length - 1]!.meta.changes) return c.json({ error: 'already_confirmed' } as const, 409);
    return c.body(null, 204);
  })

  // 候補日の確定（作成者のみ）。未確定からの条件付き更新と予定の生成を同一バッチで行う
  .post('/polls/:id/confirm', json(confirmBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const poll = await get<PollRow>(c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(c.req.param('id')).first());
    if (!poll) return c.json({ error: 'not_found' } as const, 404);
    const target = await pollTarget(c, poll, false);
    if (!can(subject, 'confirmPoll', target)) return c.json({ error: 'forbidden' } as const, 403);
    const body = { data: c.req.valid('json') };
    const { candidateId } = body.data;
    const candidate = await get<CandidateRow>(c.env.DB.prepare(
      `SELECT * FROM candidates WHERE id = ? AND poll_id = ?`
    ).bind(candidateId, poll.id).first());
    if (!candidate) return c.json({ error: 'invalid_body' } as const, 400);

    if (poll.status === 'confirmed') {
      // 同一候補の再送は既存結果を返し、別候補は競合（service-design.md 手順4）
      if (poll.confirmed_candidate_id === candidateId) {
        const event = await get<EventRow>(c.env.DB.prepare(`SELECT id, date, start_time FROM events WHERE source_poll_id = ?`).bind(poll.id).first());
        return c.json({ poll: { id: poll.id, status: 'confirmed', confirmedCandidateId: candidateId }, event: event ?? null } as const, 200);
      }
      return c.json({ error: 'conflict', confirmedCandidateId: poll.confirmed_candidate_id } as const, 409);
    }

    const eventId = crypto.randomUUID();
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE polls SET status = 'confirmed', confirmed_candidate_id = ?, reopen_pending = 0, edit_version = edit_version + 1
         WHERE id = ? AND status = 'open' AND EXISTS (SELECT 1 FROM candidates WHERE id = ? AND poll_id = ?)`
      ).bind(candidateId, poll.id, candidateId, poll.id),
      c.env.DB.prepare(
        `INSERT INTO events (id, group_id, date, start_time, title, source_poll_id, created_at)
         SELECT ?, p.group_id, c.date, c.start_time, p.title, p.id, ?
         FROM polls p JOIN candidates c ON c.id = p.confirmed_candidate_id
         WHERE p.id = ? AND p.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM events WHERE source_poll_id = p.id)`
      ).bind(eventId, now(), poll.id),
    ]);
    if (!results[0]!.meta.changes) {
      // 同時確定: 先に成立した方を正本として結果を返す
      const latest = await get<PollRow>(c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(poll.id).first());
      if (latest?.confirmed_candidate_id === candidateId) {
        const event = await get<EventRow>(c.env.DB.prepare(`SELECT id, date, start_time FROM events WHERE source_poll_id = ?`).bind(poll.id).first());
        return c.json({ poll: { id: poll.id, status: 'confirmed', confirmedCandidateId: candidateId }, event: event ?? null } as const, 200);
      }
      return c.json({ error: 'conflict', confirmedCandidateId: latest?.confirmed_candidate_id ?? null } as const, 409);
    }
    // バッチで生成した予定IDをそのまま返し、直後の再確定で別の予定IDを古い画面へ返さないようにする
    return c.json({
      poll: { id: poll.id, status: 'confirmed', confirmedCandidateId: candidateId },
      event: { id: eventId, date: candidate.date, start_time: candidate.start_time },
    } as const, 200);
  })

  // 確定の取り消し（作成者のみ）。古い確定画面からの取消が新しい確定を消さないよう、対象の予定IDを条件にする
  .post('/polls/:id/unconfirm', json(unconfirmBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const poll = await get<PollRow>(c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(c.req.param('id')).first());
    if (!poll) return c.json({ error: 'not_found' } as const, 404);
    const target = await pollTarget(c, poll, false);
    if (!can(subject, 'confirmPoll', target)) return c.json({ error: 'forbidden' } as const, 403);
    const { eventId } = c.req.valid('json');
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE polls SET status = 'open', confirmed_candidate_id = NULL, deadline_at = ?, reopen_pending = 1, edit_version = edit_version + 1
         WHERE id = ? AND status = 'confirmed'
           AND EXISTS (SELECT 1 FROM events WHERE source_poll_id = ? AND id = ?)`
      ).bind(now(), poll.id, poll.id, eventId),
      c.env.DB.prepare(
        `DELETE FROM events WHERE source_poll_id = ? AND id = ? AND EXISTS (
           SELECT 1 FROM polls WHERE id = ? AND status = 'open' AND confirmed_candidate_id IS NULL
         )`
      ).bind(poll.id, eventId, poll.id),
    ]);
    if (!results[0]!.meta.changes) {
      const latest = await get<PollRow>(c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(poll.id).first());
      if (latest?.status !== 'open') return c.json({ error: 'conflict' } as const, 409);
    }
    return c.json({ poll: { id: poll.id, status: 'open' } } as const, 200);
  })

  // 予定の追加（メンバー以上）
  .post('/groups/:id/events', json(eventBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    if (!(await memberRole(c, groupId, subject.userId))) return c.json({ error: 'forbidden' } as const, 403);
    const body = { data: c.req.valid('json') };
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO events (id, group_id, date, start_time, title, memo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, groupId, body.data.date, body.data.time ?? null, body.data.title, body.data.memo ?? null, now()).run();
    return c.json({ event: { id } } as const, 201);
  })

  // 所属グループの月カレンダー（メンバー以外は自分の予定を返さない）
  .get('/calendar', async (c) => {
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const month = c.req.query('month') ?? '';
    if (!monthQuery.test(month)) return c.json({ error: 'invalid_query' } as const, 400);
    const events = await all<EventRow & { group_name: string; group_color: string | null }>(c.env.DB.prepare(
      `SELECT e.*, g.name AS group_name, g.color AS group_color FROM events e
       JOIN groups g ON g.id = e.group_id
       JOIN memberships m ON m.group_id = e.group_id AND m.user_id = ?
       WHERE e.date >= ? AND e.date < ?
       ORDER BY e.date, e.start_time`
    ).bind(subject.userId, `${month}-01`, `${month}-32`).all());
    return c.json({
      events: events.map(e => ({
        id: e.id, date: e.date, startTime: e.start_time, title: e.title, memo: e.memo,
        group: { id: e.group_id, name: e.group_name, color: e.group_color },
        sourcePollId: e.source_poll_id,
      })),
    } as const);
  })

  // --- #32 予定通知の設定 -----------------------------------------------------

  // 通知設定の読み出し（本人のみ）。未設定なら無効・既定時刻を返す
  .get('/settings/notifications', async (c) => {
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const row = await get<{ notify_enabled: number; notify_time: string }>(c.env.DB.prepare(
      `SELECT notify_enabled, notify_time FROM user_settings WHERE user_id = ?`
    ).bind(subject.userId).first());
    return c.json({
      enabled: Boolean(row?.notify_enabled),
      time: row?.notify_time ?? '08:00',
    } as const);
  })

  // 通知設定の保存（本人のみ）。冪等なupsertで、時刻はHH:MMに検証済み
  .put('/settings/notifications', json(notificationSettingsBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const body = { data: c.req.valid('json') };
    await c.env.DB.prepare(
      `INSERT INTO user_settings (user_id, notify_enabled, notify_time, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET notify_enabled = excluded.notify_enabled, notify_time = excluded.notify_time, updated_at = excluded.updated_at`
    ).bind(subject.userId, body.data.enabled ? 1 : 0, body.data.time, now()).run();
    return c.json({ enabled: body.data.enabled, time: body.data.time } as const);
  })

  // 内部用の招待到達率。既定は直近30日の日別。利用者向け画面には出さず、運用者だけがBearerトークンで読む
  .get('/analytics/funnel', async (c) => {
    const token = c.env.ANALYTICS_TOKEN;
    if (!token) return c.json({ error: 'analytics_not_configured' } as const, 503);
    if (c.req.header('authorization') !== `Bearer ${token}`) return c.json({ error: 'unauthenticated' } as const, 401);
    const daysParam = Number(c.req.query('days') ?? '30');
    const days = Number.isInteger(daysParam) && daysParam >= 1 && daysParam <= 90 ? daysParam : 30;
    const end = analyticsDay();
    const startTimestamp = Date.parse(`${end}T00:00:00Z`) - (days - 1) * 24 * 60 * 60 * 1000;
    const dates = Array.from({ length: days }, (_, index) => analyticsDay(startTimestamp + index * 24 * 60 * 60 * 1000));
    const rows = await all<{ day: string; event_type: AnalyticsEventType; n: number }>(c.env.DB.prepare(
      `SELECT occurred_on AS day, event_type, COUNT(*) AS n FROM analytics_events
       WHERE occurred_on >= ? AND occurred_on <= ? AND event_type IN ('invite_visit', 'answer_submit', 'usage_start_click', 'usage_start')
       GROUP BY occurred_on, event_type`
    ).bind(dates[0], end).all());
    const byDay = new Map(dates.map(day => [day, { date: day, validLinkVisits: 0, answerCompletions: 0, usageStartClicks: 0, usageStarts: 0 }]));
    for (const row of rows) {
      const entry = byDay.get(row.day);
      if (!entry) continue;
      if (row.event_type === 'invite_visit') entry.validLinkVisits = row.n;
      else if (row.event_type === 'answer_submit') entry.answerCompletions = row.n;
      else if (row.event_type === 'usage_start_click') entry.usageStartClicks = row.n;
      else if (row.event_type === 'usage_start') entry.usageStarts = row.n;
    }
    const rates = (entry: { validLinkVisits: number; answerCompletions: number; usageStartClicks: number; usageStarts: number }) => ({
      completionRate: entry.validLinkVisits ? entry.answerCompletions / entry.validLinkVisits : null,
      usageStartClickRate: entry.answerCompletions ? entry.usageStartClicks / entry.answerCompletions : null,
      usageStartRate: entry.answerCompletions ? entry.usageStarts / entry.answerCompletions : null,
    });
    const daily = [...byDay.values()].map(entry => ({ ...entry, ...rates(entry) }));
    const totals = daily.reduce((sum, entry) => ({
      validLinkVisits: sum.validLinkVisits + entry.validLinkVisits,
      answerCompletions: sum.answerCompletions + entry.answerCompletions,
      usageStartClicks: sum.usageStartClicks + entry.usageStartClicks,
      usageStarts: sum.usageStarts + entry.usageStarts,
    }), { validLinkVisits: 0, answerCompletions: 0, usageStartClicks: 0, usageStarts: 0 });
    return c.json({
      range: { start: dates[0], end, days },
      definition: {
        visit: '有効な回答リンクを開いた回数。無効リンクは分母に含めない',
        completion: '有効な回答リンクから回答書き込みが受理された回数',
        usageStartClick: '回答完了画面で「自分のグループを作る」が押された回数',
        usageStart: 'ゲスト回答者がログインし、最初の自分のグループを作成した回数',
        dedupe: 'イベント種別＋招待の内部ID＋匿名訪問者Cookieで一意。再読込・再送は重複除外し、再発行リンクは別の招待として数える',
        rate: 'completionRateは answerCompletions / validLinkVisits、usageStartClickRateとusageStartRateは分母をanswerCompletionsとする。日別も同じ日に記録された数値の比',
        future: '有料転換率は checkout_completed を同じ匿名イベント構造で追加して区別する',
      },
      totals: { ...totals, ...rates(totals) },
      daily,
    } as const);
  })

  // --- ゲスト（回答リンク） ---------------------------------------------------

  // 回答完了画面の「自分のグループを作る」クリック。遷移を止めず、匿名計測だけを行う
  .post('/invite/usage-start-click', json(inviteBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const body = { data: c.req.valid('json') };
    const invite = await findInvite(c, body.data.token);
    if (!invite || invite.purpose !== 'answer' || !invite.poll_id) {
      return c.json({ error: 'invite_invalid' } as const, 404);
    }
    const visitorId = await ensureGuest(c);
    await recordAnalytics(c, 'usage_start_click', invite.id, invite.poll_id, visitorId);
    return c.body(null, 204);
  })

  // 招待トークンで調整を開く。返すのはその調整・自分の回答・確定日だけ（メンバー一覧や他の予定は出さない）
  .post('/invite', json(inviteBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const body = { data: c.req.valid('json') };
    const invite = await findInvite(c, body.data.token);
    if (!invite || invite.purpose !== 'answer' || !invite.poll_id) {
      return c.json({ error: 'invite_invalid' } as const, 404);
    }
    const poll = await get<PollRow>(c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(invite.poll_id).first());
    if (!poll) return c.json({ error: 'invite_invalid' } as const, 404);
    const visitVisitorId = await ensureGuest(c);
    await recordAnalytics(c, 'invite_visit', invite.id, poll.id, visitVisitorId);
    const subject = await subjectOf(c);
    let ownAnswer: { name: string; comment: string | null; votes: Record<string, string> } | null = null;
    const key = subject.userId ? `u:${subject.userId}` : subject.guestId ? `g:${subject.guestId}` : undefined;
    if (key) {
      const row = await get<AnswerRow>(c.env.DB.prepare(
        `SELECT * FROM answers WHERE poll_id = ? AND respondent_key = ?`
      ).bind(poll.id, key).first());
      if (row) {
        const votes = await all<VoteRow>(c.env.DB.prepare(`SELECT * FROM votes WHERE answer_id = ?`).bind(row.id).all());
        ownAnswer = { name: row.display_name, comment: row.comment, votes: Object.fromEntries(votes.map(v => [v.candidate_id, v.value])) };
      }
    }
    const [group, candidates, confirmed, host] = await Promise.all([
      get<GroupRow>(c.env.DB.prepare(`SELECT id, name, color FROM groups WHERE id = ?`).bind(poll.group_id).first()),
      all<CandidateRow>(c.env.DB.prepare(`SELECT * FROM candidates WHERE poll_id = ? ORDER BY position`).bind(poll.id).all()),
      poll.confirmed_candidate_id
        ? get<CandidateRow>(c.env.DB.prepare(`SELECT * FROM candidates WHERE id = ?`).bind(poll.confirmed_candidate_id).first())
        : Promise.resolve(null),
      get<{ display_name: string | null }>(c.env.DB.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(poll.creator_id).first()),
    ]);
    const accepting = poll.status === 'open' && !poll.reopen_pending && (!poll.deadline_at || poll.deadline_at > now());
    return c.json({
      poll: {
        id: poll.id,
        title: poll.title,
        status: poll.status,
        accepting,
        deadlineAt: poll.deadline_at,
        group: group!,
        host: host?.display_name ?? null,
        candidates: candidates.map(cand => ({ id: cand.id, date: cand.date, startTime: cand.start_time })),
        confirmed: confirmed ? { date: confirmed.date, startTime: confirmed.start_time } : null,
        ownAnswer,
      },
    } as const);
  })

  // ゲスト・メンバーの回答（○△×）。同一送信の再試行は (poll_id, respondent_key) で1件に統合
  .post('/invite/answer', limitAnswerIp, json(answerBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const body = { data: c.req.valid('json') };
    const invite = await findInvite(c, body.data.token);
    if (!invite || invite.purpose !== 'answer' || !invite.poll_id) {
      return c.json({ error: 'invite_invalid' } as const, 404);
    }
    const poll = await get<PollRow>(c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(invite.poll_id).first());
    if (!poll) return c.json({ error: 'invite_invalid' } as const, 404);

    const subject = await subjectOf(c);
    // 初回のゲストはCookieがまだ無いので、ここで発行してからリンク回答者として判定する
    if (!subject.userId && !subject.guestId) subject.guestId = await ensureGuest(c);
    const target = await pollTarget(c, poll, true);
    if (!can(subject, 'answerPoll', target)) return c.json({ error: 'forbidden' } as const, 403);

    const ids = subject.userId ? { userId: subject.userId } : { guestId: subject.guestId! };
    const key = ids.userId ? `u:${ids.userId}` : `g:${ids.guestId}`;
    if (!await limitAnswer(
      c.env.ANSWER_RESPONDENT_RATE_LIMIT,
      `answer-respondent:${invite.token_hash}:${key}`,
      c.env.ANSWER_RESPONDENT_RATE_LIMIT_PER_MINUTE,
      10,
    )) return rateLimited(c);

    // リンク単位の簡易レート制限: 1時間に新しい回答者は30人まで。ゲスト識別子を取り直した連投への抑止。
    // 既に回答済みの人の変更は制限しない
    const existing = await get<{ id: string }>(c.env.DB.prepare(
      `SELECT id FROM answers WHERE poll_id = ? AND respondent_key = ?`
    ).bind(poll.id, key).first());
    if (!existing) {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const recent = await get<{ n: number }>(c.env.DB.prepare(
        `SELECT COUNT(DISTINCT respondent_key) AS n FROM answers WHERE poll_id = ? AND created_at > ?`
      ).bind(poll.id, hourAgo).first());
      if ((recent?.n ?? 0) >= 30) return rateLimited(c);
    }

    // 対象調整に属する候補だけを受理し、同一候補の重複送信は最初の1件に絞る
    const validIds = new Set(
      (await all<{ id: string }>(c.env.DB.prepare(`SELECT id FROM candidates WHERE poll_id = ?`).bind(poll.id).all())).map(row => row.id)
    );
    const stale = body.data.votes.some(v => !validIds.has(v.candidateId));
    const seen = new Set<string>();
    const votes = body.data.votes.filter(v => validIds.has(v.candidateId) && !seen.has(v.candidateId) && (seen.add(v.candidateId), true));
    // 編集で消えた候補を混ぜた古いフォームの送信は、残った候補だけを受理済みに見せず競合として返す
    if (stale) return c.json({ error: 'stale_candidates' } as const, 409);
    if (!votes.length) return c.json({ error: 'invalid_body' } as const, 400);

    // 締切・確定済みの調整には、既存回答があっても新しい送信を受け付けない
    const accepting = poll.status === 'open' && !poll.reopen_pending && (!poll.deadline_at || new Date(poll.deadline_at).getTime() > Date.now());
    if (!accepting) return c.json({ error: 'closed' } as const, 410);

    const { wrote, saved, savedVotes } = await writeAnswer(c, poll.id, key, ids, body.data.name, body.data.comment ?? null, votes);
    // 受付チェックと書き込みの間に確定・締切が入ると条件付きSQLは0行になる。書き込み後に再読して、
    // 締まっていれば410、受付中なら最新の回答を冪等に返す（同一回答者の競合書き込みも受理扱い）
    const latest = await get<Pick<PollRow, 'status' | 'deadline_at' | 'reopen_pending'>>(c.env.DB.prepare(
      `SELECT status, deadline_at, reopen_pending FROM polls WHERE id = ?`
    ).bind(poll.id).first());
    const stillOpen = latest?.status === 'open' && !latest.reopen_pending && (!latest.deadline_at || new Date(latest.deadline_at).getTime() > Date.now());
    if (!stillOpen) return c.json({ error: 'closed' } as const, 410);
    if (!wrote || !saved || (votes.length && !savedVotes.length)) return c.json({ error: 'conflict' } as const, 409);
    const answerVisitorId = subject.guestId ?? await ensureGuest(c);
    await recordAnalytics(c, 'answer_submit', invite.id, poll.id, answerVisitorId);
    return c.json({
      answer: {
        id: saved.id,
        name: saved.display_name,
        comment: saved.comment,
        votes: Object.fromEntries(savedVotes.map(v => [v.candidate_id, v.value])),
      },
    } as const, 200);
  });
}

export const dataRoutes = buildDataRoutes(authDeps);
