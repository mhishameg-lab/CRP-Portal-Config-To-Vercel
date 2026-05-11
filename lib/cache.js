// lib/cache.js — In-process cache replacing GAS CacheService.
//
// On Vercel each invocation may be a cold start (no shared memory between
// lambdas). For production use, swap this with Vercel KV / Upstash Redis:
//   https://vercel.com/docs/storage/vercel-kv
//
// The API is intentionally identical to CacheService so services can swap
// the implementation without changing call sites.

import NodeCache from 'node-cache';

// Single global instance — shared across requests in the same lambda instance.
// stdTTL=0 means entries live until explicitly deleted or maxTTL overrides.
const _cache = new NodeCache({ stdTTL: 0, checkperiod: 60 });

export const cache = {
  /**
   * Retrieve a cached value.
   * @param {string} key
   * @returns {any|null} Parsed value or null if missing / expired.
   */
  get(key) {
    const val = _cache.get(key);
    return val === undefined ? null : val;
  },

  /**
   * Store a value.
   * @param {string} key
   * @param {any}    value  — will be stored as-is (already parsed objects are fine)
   * @param {number} ttlSec — TTL in seconds (capped at 21600 = 6 h, GAS limit)
   */
  set(key, value, ttlSec = 300) {
    _cache.set(key, value, Math.min(ttlSec, 21600));
  },

  /**
   * Remove a key.
   * @param {string} key
   */
  remove(key) {
    _cache.del(key);
  },

  /**
   * Remove multiple keys by prefix.
   * @param {string} prefix
   */
  removeByPrefix(prefix) {
    const keys = _cache.keys().filter(k => k.startsWith(prefix));
    if (keys.length) _cache.del(keys);
  },
};
