// lib/utils.js — Replaces GAS Utilities / pure helper functions

import crypto from 'crypto';

// ─── Hashing & tokens ────────────────────────────────────────────────────────

/** SHA-256 hex digest — identical output to GAS hashPassword() */
export function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

/** Verify a password against its stored hash */
export function verifyPassword(plain, hashed) {
  return hashPassword(plain) === hashed;
}

/** MD5 hex — used for watch-hash change detection */
export function md5(str) {
  return crypto.createHash('md5').update(String(str)).digest('hex');
}

/** Random UUID token */
export function generateToken() {
  return crypto.randomUUID();
}

/** Prefixed random ID, e.g. "INC-1715000000000-A3F2K1" */
export function generateId(prefix = 'ID') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/** Lead ID with date component, e.g. "LEAD-20240501-3742" */
export function generateLeadId(dateValue) {
  const d  = dateValue instanceof Date ? dateValue : new Date(dateValue || Date.now());
  const ds = isNaN(d) ? todayStr() : formatDate(d, 'yyyyMMdd');
  return `LEAD-${ds}-${String(Math.floor(1000 + Math.random() * 9000))}`;
}

// ─── Date utilities ───────────────────────────────────────────────────────────

/** ISO timestamp string */
export function now() { return new Date().toISOString(); }

/** Today as "yyyyMMdd" */
export function todayStr() { return formatDate(new Date(), 'yyyyMMdd'); }

/**
 * Format a date value using a simplified GAS-style format string.
 * Supports: yyyy, MM, dd, HH, mm, ss
 */
export function formatDate(val, fmt = 'yyyy-MM-dd') {
  if (!val) return '';
  try {
    const d = val instanceof Date ? val : new Date(val);
    if (isNaN(d)) return String(val);
    const pad = (n) => String(n).padStart(2, '0');
    return fmt
      .replace('yyyy', d.getFullYear())
      .replace('MM',   pad(d.getMonth() + 1))
      .replace('dd',   pad(d.getDate()))
      .replace('HH',   pad(d.getHours()))
      .replace('mm',   pad(d.getMinutes()))
      .replace('ss',   pad(d.getSeconds()));
  } catch (_) { return String(val); }
}

/** Alias used in ported code */
export const fmtDate = formatDate;

// ─── Array column helpers ─────────────────────────────────────────────────────

/** Safely coerce a Sheets cell value to string */
export function str(val) { return val === null || val === undefined ? '' : String(val); }

/** Number or 0 */
export function num(val) { const n = Number(val); return isNaN(n) ? 0 : n; }
