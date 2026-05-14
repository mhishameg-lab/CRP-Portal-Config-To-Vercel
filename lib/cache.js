import { Redis } from '@upstash/redis';

let redis;
try {
  redis = new Redis({
    url  : process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
} catch (_) {}

async function safeOp(fn) {
  if (!redis) return null;
  try { return await fn(); } catch (_) { return null; }
}

export const cache = {
  get   : (key)           => safeOp(() => redis.get(key)),
  set   : (key, val, ttl) => safeOp(() => redis.set(key, val, { ex: ttl })),
  remove: (key)           => safeOp(() => redis.del(key)),
};
