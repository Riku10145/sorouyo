import type { C } from '../../context';

const RATE_LIMIT_MESSAGE = '少し時間をおいてもう一度お試しください';

export const rateLimited = (c: C) => c.json({ error: 'rate_limited', message: RATE_LIMIT_MESSAGE } as const, 429);

const positiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

// ユニットテストなどbindingがない環境向けのフォールバック。アプリごとにカウンターを持ち、
// 独立したテスト同士が回数枠を共有しないようにする。本番・ローカルWorkerでは wrangler.jsonc の
// Rate Limiting binding が使われ、上限もそちらの simple.limit で変更する。
export const makeAnswerLimiter = () => {
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
export const clientIp = (c: C) => c.req.header('cf-connecting-ip')?.trim() || 'unknown';
