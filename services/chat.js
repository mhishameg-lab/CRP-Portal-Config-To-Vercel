// services/chat.js — Port of ChatService.gs
// All sheet access uses getCrmSheet(). Auth delegates to lib/auth.js.

import { getCrmSheet } from '../lib/sheets.js';
import { requireAuth as _reqAuth, requireAdmin as _reqAdmin } from '../lib/auth.js';
import { now } from '../lib/utils.js';
import { SHEETS } from '../lib/config.js';
import { uploadImageToDrive } from '../lib/drive.js';
import { cache } from '../lib/cache.js';

const CHAT_MSG_COLS = 11;

// ─── Identity helper ──────────────────────────────────────────────────────────

async function _chatId(token) {
  try {
    const sess = await _reqAuth(token);
    const role = sess.role;
    return {
      team    : role === 'admin'  ? 'ICO Admin'
              : role === 'closer' ? 'Closing Team'
              : String(sess.centerCode || sess.username),
      isAdmin : role === 'admin',
      isCloser: role === 'closer' || role === 'admin',
      role,
      username: sess.username,
    };
  } catch (_) { return null; }
}

function _rowToChatMsg(row) {
  return {
    id         : Number(row[0]),
    timestamp  : row[1],
    team       : String(row[2] || ''),
    toTeam     : String(row[3] || ''),
    message    : String(row[4] || ''),
    replyTo    : row[5] || null,
    forwarded  : row[6] === true || row[6] === 'TRUE',
    forwardedAt: row[7] || '',
    type       : String(row[8] || 'message'),
    pinned     : row[9] === true || row[9] === 'TRUE',
    pinnedAt   : row[10] || '',
  };
}

// ─── Cached sheet readers ─────────────────────────────────────────────────────

async function _getChatMsgRows() {
  const key = 'chat_msgs_rows';
  const hit = cache.get(key);
  if (hit) return hit;
  const sheet = await getCrmSheet(SHEETS.CHAT_MSGS_V2);
  const rows  = await sheet.getValues();
  cache.set(key, rows, 5); // cache 5 seconds
  return rows;
}

async function _getChatRingRows() {
  const key = 'chat_ring_rows';
  const hit = cache.get(key);
  if (hit) return hit;
  const sheet = await getCrmSheet(SHEETS.CHAT_RING);
  const rows  = await sheet.getValues();
  cache.set(key, rows, 5);
  return rows;
}

function _invalidateChatCache() {
  cache.remove('chat_msgs_rows');
  cache.remove('chat_ring_rows');
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function chatGetIdentity(token) {
  const id = await _chatId(token);
  if (!id) return { valid: false };
  return { valid: true, team: id.team, isAdmin: id.isAdmin, isCloser: id.isCloser, role: id.role };
}

export async function chatGetCenters(token) {
  const id = await _chatId(token);
  if (!id || !id.isCloser) return { success: false, error: 'Not authorised.' };
  const sheet   = await getCrmSheet(SHEETS.USERS);
  const rows    = await sheet.getValues();
  const centers = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2] || '').toLowerCase() === 'center' &&
        String(rows[i][3] || '').toLowerCase() === 'active') {
      centers.push({ centerCode: String(rows[i][0]) });
    }
  }
  return { success: true, centers };
}

export async function chatSendMessage(token, toTeam, message, replyTo) {
  const id = await _chatId(token);
  if (!id) return { success: false, error: 'Not authorised.' };
  message = (message || '').trim();
  if (!message)              return { success: false, error: 'Message is empty.' };
  if (message.length > 2000) return { success: false, error: 'Max 2000 characters.' };

  const actualTo = id.isCloser ? (toTeam || 'Closing Team') : 'Closing Team';
  const sheet    = await getCrmSheet(SHEETS.CHAT_MSGS_V2);
  const lastRow  = await sheet.getLastRow();
  await sheet.appendRow([lastRow, new Date().toISOString(), id.team, actualTo, message, replyTo || '', false, '', 'message', false, '']);
  _invalidateChatCache(); // Invalidate cached rows
  return { success: true, id: lastRow };
}

export async function chatBroadcast(token, message) {
  const id = await _chatId(token);
  if (!id || !id.isAdmin) return { success: false, error: 'Not authorised.' };
  message = (message || '').trim();
  if (!message) return { success: false, error: 'Empty message.' };
  const sheet   = await getCrmSheet(SHEETS.CHAT_MSGS_V2);
  const lastRow = await sheet.getLastRow();
  await sheet.appendRow([lastRow, new Date().toISOString(), 'ADMIN', 'ALL', message, '', false, '', 'broadcast', false, '']);
  _invalidateChatCache(); // Invalidate cached rows
  return { success: true, id: lastRow };
}

export async function chatGetMessages(token, convTeam, afterId) {
  const id = await _chatId(token);
  if (!id) return { success: false, error: 'Not authorised.', messages: [] };
  afterId = Number(afterId) || 0;

  const allRows = await _getChatMsgRows();

  if (allRows.length <= 1) return { success: true, messages: [] };

  const data = allRows.slice(1);
  const out  = [];

  for (const row of data) {
    const msgId   = Number(row[0]);
    if (msgId <= afterId) continue;
    const msgTeam = String(row[2] || '');
    const toTeam  = String(row[3] || '');
    const type    = String(row[8] || 'message');

    if (convTeam === '__broadcast__') {
      if (type === 'broadcast') out.push(_rowToChatMsg(row));
      continue;
    }

    if (id.isCloser) {
      const inChannel =
        (msgTeam === convTeam       && toTeam === 'Closing Team') ||
        (msgTeam === 'Closing Team' && toTeam === convTeam)       ||
        (msgTeam === 'ICO Admin'    && toTeam === convTeam)       ||
        (type === 'broadcast');
      if (inChannel) out.push(_rowToChatMsg(row));
    } else {
      const inChannel =
        (msgTeam === id.team        && toTeam === 'Closing Team') ||
        (msgTeam === 'Closing Team' && toTeam === id.team)        ||
        (msgTeam === 'ICO Admin'    && toTeam === id.team)        ||
        (type === 'broadcast');
      if (inChannel) out.push(_rowToChatMsg(row));
    }
  }
  return { success: true, messages: out.slice(-200) };
}

export async function chatGetPinned(token) {
  const id = await _chatId(token);
  if (!id) return { success: false, messages: [] };
  const allRows = await _getChatMsgRows();
  if (allRows.length <= 1) return { success: true, messages: [] };
  const pinned = allRows.slice(1)
    .filter(r => r[9] === true || r[9] === 'TRUE')
    .map(_rowToChatMsg)
    .slice(-50);
  return { success: true, messages: pinned };
}

// ─── Ring alert ───────────────────────────────────────────────────────────────

export async function chatSendRing(token) {
  const id = await _chatId(token);
  if (!id)         return { success: false, error: 'Not authorised.' };
  if (id.isCloser) return { success: false, error: 'Closing team cannot ring itself.' };
  const sheet   = await getCrmSheet(SHEETS.CHAT_RING);
  const lastRow = await sheet.getLastRow();
  await sheet.appendRow([lastRow, id.team, new Date().toISOString(), false]);
  _invalidateChatCache(); // Invalidate cached rows
  return { success: true };
}

export async function chatCheckRing(token) {
  const id = await _chatId(token);
  if (!id || !id.isCloser) return { pending: false };
  const allRows = await _getChatMsgRows();
  if (allRows.length <= 1) return { pending: false };
  for (const row of allRows.slice(1)) {
    if (row[3] !== true && row[3] !== 'TRUE')
      return { pending: true, id: Number(row[0]), fromTeam: String(row[1]), timestamp: row[2] };
  }
  return { pending: false };
}

export async function chatClearRing(token) {
  const id = await _chatId(token);
  if (!id) return { success: false };
  const sheet   = await getCrmSheet(SHEETS.CHAT_RING);
  const allRows = await sheet.getValues();
  if (allRows.length <= 1) return { success: true };
  // Mark all unacknowledged rows
  const updates = [];
  for (let i = 1; i < allRows.length; i++) {
    if (allRows[i][3] !== true && allRows[i][3] !== 'TRUE') {
      updates.push(sheet.setCell(i + 1, 4, true));
    }
  }
  await Promise.all(updates);
  _invalidateChatCache(); // Invalidate cached rows
  return { success: true };
}

// ─── Status ───────────────────────────────────────────────────────────────────

export async function chatUpdateStatus(token, status) {
  const id = await _chatId(token);
  if (!id) return { success: false };
  if (!['online', 'away', 'busy'].includes(status)) return { success: false };
  const sheet   = await getCrmSheet(SHEETS.CHAT_STATUS);
  const allRows = await sheet.getValues();
  for (let i = 1; i < allRows.length; i++) {
    if (allRows[i][0] === id.team) {
      await sheet.setCell(i + 1, 2, status);
      await sheet.setCell(i + 1, 3, new Date().toISOString());
      return { success: true };
    }
  }
  await sheet.appendRow([id.team, status, new Date().toISOString()]);
  return { success: true };
}

export async function chatGetStatuses(token) {
  const id = await _chatId(token);
  if (!id) return { success: false, statuses: [] };
  const sheet   = await getCrmSheet(SHEETS.CHAT_STATUS);
  const allRows = await sheet.getValues();
  if (allRows.length <= 1) return { success: true, statuses: [] };
  return {
    success : true,
    statuses: allRows.slice(1).filter(r => r[0]).map(r => ({
      team: String(r[0]), status: String(r[1] || 'offline'), updatedAt: r[2],
    })),
  };
}

// ─── Admin message actions ────────────────────────────────────────────────────

export async function chatPinMessage(token, msgId, shouldPin) {
  const id = await _chatId(token);
  if (!id || !id.isAdmin) return { success: false, error: 'Not authorised.' };
  return _mutateChatMsg(msgId, row => {
    row[9]  = shouldPin !== false;
    row[10] = shouldPin !== false ? new Date().toISOString() : '';
    return row;
  });
}

export async function chatForwardMessage(token, msgId) {
  const id = await _chatId(token);
  if (!id || !id.isAdmin) return { success: false, error: 'Not authorised.' };
  return _mutateChatMsg(msgId, row => {
    row[6] = true;
    row[7] = new Date().toISOString();
    return row;
  });
}

export async function chatDeleteMessage(token, msgId) {
  const id = await _chatId(token);
  if (!id || !id.isAdmin) return { success: false, error: 'Not authorised.' };
  msgId = Number(msgId);
  const sheet   = await getCrmSheet(SHEETS.CHAT_MSGS_V2);
  const allRows = await sheet.getValues();
  if (allRows.length <= 1) return { success: false, error: 'No messages.' };
  for (let i = allRows.length - 1; i >= 1; i--) {
    if (Number(allRows[i][0]) === msgId) {
      await sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  _invalidateChatCache(); // Invalidate cached rows
  return { success: false, error: 'Message not found.' };
}

async function _mutateChatMsg(msgId, fn) {
  msgId = Number(msgId);
  const sheet   = await getCrmSheet(SHEETS.CHAT_MSGS_V2);
  const allRows = await sheet.getValues();
  if (allRows.length <= 1) return { success: false, error: 'No messages.' };
  for (let i = 1; i < allRows.length; i++) {
    if (Number(allRows[i][0]) === msgId) {
      const updated = fn([...allRows[i]]);
      await sheet.setRange(i + 1, 1, [updated.slice(0, CHAT_MSG_COLS)]);
      return { success: true };
    }
  }
  return { success: false, error: 'Message not found.' };
}

// ─── Image upload ─────────────────────────────────────────────────────────────

export async function chatUploadImage(token, toTeam, base64Data, mimeType, filename, replyTo) {
  const id = await _chatId(token);
  if (!id) return { success: false, error: 'Not authorised.' };
  try {
    const url      = await uploadImageToDrive(base64Data, mimeType, filename);
    const actualTo = id.isCloser ? (toTeam || 'Closing Team') : 'Closing Team';
    const sheet    = await getCrmSheet(SHEETS.CHAT_MSGS_V2);
    const lastRow  = await sheet.getLastRow();
    await sheet.appendRow([lastRow, new Date().toISOString(), id.team, actualTo, url, replyTo || '', false, '', 'image', false, '']);
    return { success: true, id: lastRow, url };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─── Unread counter (V2) ──────────────────────────────────────────────────────

export async function getNewChatUnread(token) {
  try {
    const sess  = await _reqAuth(token);
    const sheet = await getCrmSheet(SHEETS.CHAT_MSGS_V2);
    const allRows = await sheet.getValues();
    if (allRows.length <= 1) return { success: true, unread: 0 };

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    let unread = 0;
    const isCloserOrAdmin = ['admin', 'closer'].includes(sess.role);

    for (const row of allRows.slice(1)) {
      const ts   = new Date(row[1]);
      const from = String(row[2] || '');
      const to   = String(row[3] || '');
      const type = String(row[8] || 'message');
      if (isNaN(ts) || ts.getTime() <= fiveMinAgo) continue;
      if (type === 'broadcast') continue;
      if (isCloserOrAdmin) {
        if (from !== 'Closing Team' && from !== 'ICO Admin' && to === 'Closing Team') unread++;
      } else {
        const myTeam = String(sess.centerCode || sess.username);
        if ((from === 'Closing Team' || from === 'ICO Admin') && to === myTeam) unread++;
      }
    }
    return { success: true, unread };
  } catch (e) { return { success: false, unread: 0 }; }
}
