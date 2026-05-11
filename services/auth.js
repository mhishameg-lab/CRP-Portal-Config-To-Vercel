// services/auth.js — Port of Auth.gs
// All SpreadsheetApp calls → getCrmSheet(). All session calls → lib/auth.js JWTs.

import { getCrmSheet, getSourceSpreadsheet } from '../lib/sheets.js';
import { hashPassword, verifyPassword, now, fmtDate } from '../lib/utils.js';
import { createToken, requireAuth as _reqAuth, requireAdmin as _reqAdmin } from '../lib/auth.js';
import { CONFIG, SHEETS, COL } from '../lib/config.js';

// ─── Activity logging ─────────────────────────────────────────────────────────

export async function logActivity(user, action, details) {
  try {
    const sheet = await getCrmSheet(SHEETS.ACTIVITY_LOG);
    await sheet.appendRow([now(), user, action, details]);
  } catch (e) { console.error('logActivity failed:', e); }
}

// ─── Auth API ─────────────────────────────────────────────────────────────────

export async function login(username, password) {
  try {
    if (!username || !password)
      return { success: false, error: 'Username and password are required.' };

    const sheet = await getCrmSheet(SHEETS.USERS);
    const rows  = await sheet.getValues();
    const uname = username.trim().toLowerCase();
    const hashed = hashPassword(password.trim());

    let found = null;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (String(row[0] || '').toLowerCase() === uname && String(row[1] || '') === hashed) {
        found = { username: row[0], role: String(row[2] || '').trim().toLowerCase(), status: row[3] };
        break;
      }
    }

    if (!found) {
      await logActivity('UNKNOWN', 'LOGIN_FAILED', `Bad credentials for: ${username}`);
      return { success: false, error: 'Invalid username or password.' };
    }
    if (String(found.status).toLowerCase() !== 'active')
      return { success: false, error: 'Account is inactive. Contact your administrator.' };

    // Resolve center name from source sheet
    let centerName = '';
    if (found.role === 'center') {
      try {
        const srcSheet = getSourceSpreadsheet();
        const srcRows  = await srcSheet.getValues(CONFIG.SOURCE_SHEET_NAME);
        for (let i = 1; i < srcRows.length; i++) {
          if (String(srcRows[i][COL.CENTER_CODE] || '').trim().toLowerCase() ===
              found.username.trim().toLowerCase()) {
            centerName = String(srcRows[i][COL.CENTER_NAME] || '').trim();
            break;
          }
        }
      } catch (_) { /* non-fatal */ }
    }

    const token = await createToken({
      username  : found.username,
      role      : found.role,
      centerCode: found.username,
      centerName: centerName || found.username,
    });

    await logActivity(found.username, 'LOGIN', 'User logged in.');

    return {
      success   : true,
      token,
      role      : found.role,
      username  : found.username,
      centerCode: found.username,
      centerName: centerName || found.username,
    };
  } catch (err) {
    console.error('login():', err);
    return { success: false, error: 'Server error during login.' };
  }
}

export async function logout(token) {
  // JWTs are stateless — no server-side invalidation needed.
  // The client should discard the token. Cookie is cleared in the API route.
  return { success: true };
}

export async function validateSession(token) {
  try {
    const { verifyToken } = await import('../lib/auth.js');
    const sess = await verifyToken(token);
    if (!sess) return { valid: false, reason: 'not_found' };
    return { valid: true, username: sess.username, role: sess.role, centerCode: sess.centerCode, centerName: sess.centerName };
  } catch (_) { return { valid: false }; }
}

// ─── User management (admin-only) ────────────────────────────────────────────

export async function getUsers(token) {
  try {
    const sess  = await _reqAdmin(token);
    const sheet = await getCrmSheet(SHEETS.USERS);
    const rows  = await sheet.getValues();
    const users = rows.slice(1).map((r, i) => ({
      rowIndex : i + 2,
      username : r[0],
      role     : r[2],
      status   : r[3],
      createdAt: fmtDate(r[4], 'yyyy-MM-dd HH:mm'),
    }));
    return { success: true, users };
  } catch (e) { return { success: false, error: e.message || String(e) }; }
}

export async function createUser(token, userData) {
  try {
    await _reqAdmin(token);
    const { username, password, role } = userData || {};
    if (!username || !password || !role)
      return { success: false, error: 'Username, password, and role are required.' };
    if (!['admin', 'closer', 'center'].includes(role))
      return { success: false, error: 'Role must be "admin", "closer", or "center".' };

    const sheet = await getCrmSheet(SHEETS.USERS);
    const rows  = await sheet.getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').toLowerCase() === username.toLowerCase())
        return { success: false, error: 'Username already exists.' };
    }

    await sheet.appendRow([username.trim(), hashPassword(password), role, 'active', now()]);
    const { verifyToken } = await import('../lib/auth.js');
    const sess = await verifyToken(token);
    await logActivity(sess.username, 'CREATE_USER', `Created user: ${username} (${role})`);
    return { success: true };
  } catch (e) { return { success: false, error: e.message || String(e) }; }
}

export async function updateUserStatus(token, username, status) {
  try {
    const sess  = await _reqAdmin(token);
    const sheet = await getCrmSheet(SHEETS.USERS);
    const rows  = await sheet.getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === username) {
        await sheet.setCell(i + 1, 4, status);
        await logActivity(sess.username, 'UPDATE_USER', `Set ${username} → ${status}`);
        return { success: true };
      }
    }
    return { success: false, error: 'User not found.' };
  } catch (e) { return { success: false, error: e.message || String(e) }; }
}

export async function resetUserPassword(token, username, newPassword) {
  try {
    const sess  = await _reqAdmin(token);
    const sheet = await getCrmSheet(SHEETS.USERS);
    const rows  = await sheet.getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === username) {
        await sheet.setCell(i + 1, 2, hashPassword(newPassword));
        await logActivity(sess.username, 'RESET_PASSWORD', `Password reset for: ${username}`);
        return { success: true };
      }
    }
    return { success: false, error: 'User not found.' };
  } catch (e) { return { success: false, error: e.message || String(e) }; }
}

export async function deleteUser(token, username) {
  try {
    const sess = await _reqAdmin(token);
    if (username === sess.username)
      return { success: false, error: 'Cannot delete your own account.' };

    const sheet = await getCrmSheet(SHEETS.USERS);
    const rows  = await sheet.getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === username) {
        await sheet.deleteRow(i + 1);
        await logActivity(sess.username, 'DELETE_USER', `Deleted user: ${username}`);
        return { success: true };
      }
    }
    return { success: false, error: 'User not found.' };
  } catch (e) { return { success: false, error: e.message || String(e) }; }
}

export async function getActivityLog(token) {
  try {
    await _reqAdmin(token);
    const sheet = await getCrmSheet(SHEETS.ACTIVITY_LOG);
    const rows  = await sheet.getValues();
    const logs  = rows.slice(1).reverse().slice(0, 500).map(r => ({
      timestamp: r[0], user: r[1], action: r[2], details: r[3],
    }));
    return { success: true, logs };
  } catch (e) { return { success: false, error: e.message || String(e) }; }
}
