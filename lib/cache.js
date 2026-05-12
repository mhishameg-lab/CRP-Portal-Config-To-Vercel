import { Redis } from '@upstash/redis';

const redis = new Redis({
  url  : process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const cache = {
  get   : (key)           => redis.get(key),
  set   : (key, val, ttl) => redis.set(key, val, { ex: ttl }),
  remove: (key)           => redis.del(key),
};