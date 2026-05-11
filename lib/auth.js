// lib/auth.js — JWT-based session management
// Replaces: _writeSession / _readSession / _deleteSession in Auth.gs
//
// Sessions are stateless JWTs stored in an httpOnly cookie named "ico_sess".
// The token string returned to the client is the JWT itself — so existing
// frontend code that stores APP.token and passes it as arg[0] still works.

import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change_me_in_production_use_a_long_random_string'
);
const SESSION_TTL_SEC = (parseInt(process.env.SESSION_TTL_HOURS) || 8) * 3600;
const ALGORITHM       = 'HS256';

// ─── JWT helpers ──────────────────────────────────────────────────────────────

/**
 * Create a signed JWT containing the session payload.
 * @param {object} payload — { username, role, centerCode, centerName }
 * @returns {Promise<string>} JWT string
 */
export async function createToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(SECRET);
}

/**
 * Verify and decode a JWT.
 * @param {string} token
 * @returns {Promise<object|null>} Decoded payload or null if invalid / expired.
 */
export async function verifyToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET, { algorithms: [ALGORITHM] });
    return payload;
  } catch (_) {
    return null;
  }
}

// ─── Request helpers ──────────────────────────────────────────────────────────

/**
 * Extract the session token from an incoming API request.
 * Priority: request body field "token" → Authorization Bearer header → cookie.
 * This keeps backward-compat with the GAS pattern where token is arg[0].
 *
 * @param {import('next').NextApiRequest} req
 * @returns {string|null}
 */
export function extractToken(req) {
  // 1. Body field (existing client code passes token as first function argument)
  if (req.body?.token) return req.body.token;
  // 2. Bearer header
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  // 3. httpOnly cookie
  const cookies = parseCookies(req);
  return cookies['ico_sess'] || null;
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(
    raw.split(';').map(c => c.trim().split('=').map(decodeURIComponent))
  );
}

/**
 * Set an httpOnly session cookie on the response.
 */
export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `ico_sess=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`
  );
}

/**
 * Clear the session cookie.
 */
export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'ico_sess=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

// ─── Guard helpers (match GAS requireAuth / requireAdmin / requireCloser) ─────

/**
 * Verify a token and return the session payload.
 * Throws with a { code, message } error object if invalid.
 */
export async function requireAuth(token) {
  const sess = await verifyToken(token);
  if (!sess) throw { code: 'AUTH_REQUIRED', message: 'Authentication required.' };
  return sess;
}

export async function requireAdmin(token) {
  const sess = await requireAuth(token);
  if (sess.role !== 'admin') throw { code: 'ADMIN_REQUIRED', message: 'Admin access required.' };
  return sess;
}

export async function requireCloser(token) {
  const sess = await requireAuth(token);
  if (!['admin', 'closer'].includes(sess.role))
    throw { code: 'CLOSER_REQUIRED', message: 'Closer or admin access required.' };
  return sess;
}
