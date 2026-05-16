// services/data.js — Port of DataService.gs
// Leads, PCP, dashboard stats, insights, notifications, change detection, audit log.

import { getCrmSheet, getSourceSpreadsheet, getSpreadsheetById } from '../lib/sheets.js';
import { requireAuth as _reqAuth, requireAdmin as _reqAdmin } from '../lib/auth.js';
import { cache } from '../lib/cache.js';
import { md5, generateId, generateLeadId, now, fmtDate } from '../lib/utils.js';
import { CONFIG, SHEETS, COL, PCP_COL, PCP_SOURCE_SHEET_NAME, DISPOSITIONS, WATCHED_FIELDS } from '../lib/config.js';
import { logActivity } from './auth.js';

async function _getPaymentSheet() {
  const ss = getSpreadsheetById(CONFIG.PAYMENT_STATUS_SHEET_ID);
  await ss.ensureSheet(CONFIG.PAYMENT_STATUS_SHEET_NAME);
  return {
    getValues: () => ss.getValues(CONFIG.PAYMENT_STATUS_SHEET_NAME),
    appendRow: (values) => ss.appendRow(CONFIG.PAYMENT_STATUS_SHEET_NAME, values),
    setCell: (row, col, value) => ss.setCell(CONFIG.PAYMENT_STATUS_SHEET_NAME, row, col, value),
  };
}

async function _getPaymentStatusRows() {
  const key = 'payment_status_rows';
  const hit = await cache.get(key);
  if (hit) return hit;
  try {
    const sheet = await _getPaymentSheet();
    const rows = await sheet.getValues();
    await cache.set(key, rows, 60);
    return rows;
  } catch (_) {
    return [];
  }
}

async function _getPaymentStatusMap() {
  const rows = await _getPaymentStatusRows();
  const map = {};
  rows.slice(1).forEach(row => {
    const leadId = String(row[0] || '').trim();
    if (leadId) map[leadId] = String(row[1] || 'Unpaid').trim() || 'Unpaid';
  });
  return map;
}

function _paymentStatusFor(map, leadId) {
  return map[leadId] || 'Unpaid';
}

function _pcpPaymentId(sourceRow) {
  return `PCP-ROW-${sourceRow}`;
}

function _parseNotificationMessage(raw) {
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
}

// ─── Source data (cached in-process) ─────────────────────────────────────────

async function _getSourceData() {
  const KEY = 'src_data_v3';
  const hit = await cache.get(KEY);
  if (hit) return hit;

  const ss      = getSourceSpreadsheet();
  const allRows = await ss.getValues(CONFIG.SOURCE_SHEET_NAME);
  if (allRows.length <= 1) return [];
  const data = allRows.slice(1).filter(r => r.some(c => c !== ''));
  await cache.set(KEY, data, CONFIG.CACHE_TTL_SEC);
  return data;
}

function _invalidateSourceCache() {
  cache.remove('src_data_v3');
}

async function _getPcpSourceData() {
  const KEY = 'pcp_data_v1';
  const hit = await cache.get(KEY);
  if (hit) return hit;

  const ss      = getSourceSpreadsheet();
  const allRows = await ss.getValues(PCP_SOURCE_SHEET_NAME);
  if (allRows.length <= 1) return [];
  const data = allRows.slice(1).filter(r => r.some(c => c !== ''));
  await cache.set(KEY, data, CONFIG.CACHE_TTL_SEC);
  return data;
}

// ─── Lead-ID mapping ──────────────────────────────────────────────────────────

async function _getIdMap() {
  const sheet = await getCrmSheet(SHEETS.LEAD_ID_MAP);
  const rows  = await sheet.getValues();
  const map   = {};
  for (let i = 1; i < rows.length; i++) {
    map[rows[i][0]] = {
      leadId         : rows[i][1],
      centerCode     : rows[i][2],
      watchHash      : rows[i][3],
      watchValuesJson: rows[i][4],
      mapRow         : i + 1,
    };
  }
  return map;
}

async function _ensureLeadId(sourceRow, rowData, idMap) {
  if (idMap[sourceRow]) return idMap[sourceRow].leadId;
  const leadId     = generateLeadId(rowData[COL.DATE]);
  const centerCode = String(rowData[COL.CENTER_CODE] || '');
  const watchHash  = _watchHash(rowData);
  const watchVals  = JSON.stringify(_watchValues(rowData));
  const sheet      = await getCrmSheet(SHEETS.LEAD_ID_MAP);
  await sheet.appendRow([sourceRow, leadId, centerCode, watchHash, watchVals, now()]);
  idMap[sourceRow] = { leadId, centerCode, watchHash, watchValuesJson: watchVals, mapRow: null };
  return leadId;
}

async function _ensureLeadIds(entries, idMap) {
  const missing = [];
  const seen = new Set();

  entries.forEach(({ sourceRow, rowData }) => {
    const key = String(sourceRow);
    if (idMap[key] || seen.has(key)) return;
    seen.add(key);

    const leadId     = generateLeadId(rowData[COL.DATE]);
    const centerCode = String(rowData[COL.CENTER_CODE] || '');
    const watchHash  = _watchHash(rowData);
    const watchVals  = JSON.stringify(_watchValues(rowData));

    idMap[key] = { leadId, centerCode, watchHash, watchValuesJson: watchVals, mapRow: null };
    missing.push([sourceRow, leadId, centerCode, watchHash, watchVals, now()]);
  });

  if (missing.length) {
    const sheet = await getCrmSheet(SHEETS.LEAD_ID_MAP);
    if (typeof sheet.appendRows === 'function') await sheet.appendRows(missing);
    else {
      for (const row of missing) await sheet.appendRow(row);
    }
  }
}

function _watchHash(rowData) {
  return md5(WATCHED_FIELDS.map(f => String(rowData[f.col] || '')).join('|'));
}

function _watchValues(rowData) {
  const obj = {};
  WATCHED_FIELDS.forEach(f => { obj[f.name] = String(rowData[f.col] || ''); });
  return obj;
}

// ─── Row → lead object ────────────────────────────────────────────────────────

async function _rowToLead(rowData, sourceRow, idMap, paymentMap = {}) {
  const leadId = await _ensureLeadId(sourceRow, rowData, idMap);
  return {
    leadId,
    sourceRow,
    date                    : fmtDate(rowData[COL.DATE]),
    centerCode              : String(rowData[COL.CENTER_CODE]               || ''),
    centerName              : String(rowData[COL.CENTER_NAME]               || ''),
    closerName              : String(rowData[COL.CLOSER_NAME]               || ''),
    leadStatus              : String(rowData[COL.LEAD_STATUS]               || ''),
    closingNotes            : String(rowData[COL.CLOSING_NOTES]             || ''),
    chaserName              : String(rowData[COL.CHASER_NAME]               || ''),
    chaserStatus            : String(rowData[COL.CHASER_STATUS]             || ''),
    chaserNote              : String(rowData[COL.CHASER_NOTE]               || ''),
    processingStatusCenters : String(rowData[COL.PROCESSING_STATUS_CENTERS] || ''),
    processingStatusICO     : String(rowData[COL.PROCESSING_STATUS_ICO]     || ''),
    snsResult               : String(rowData[COL.SNS_RESULT]                || ''),
    leadType                : String(rowData[COL.LEAD_TYPE]                 || ''),
    requestedProducts       : String(rowData[COL.REQUESTED_PRODUCTS]        || ''),
    firstName               : String(rowData[COL.FIRST_NAME]                || ''),
    lastName                : String(rowData[COL.LAST_NAME]                 || ''),
    fullName                : [rowData[COL.FIRST_NAME], rowData[COL.LAST_NAME]].filter(Boolean).join(' '),
    phone                   : String(rowData[COL.PHONE]                     || ''),
    address                 : String(rowData[COL.ADDRESS]                   || ''),
    city                    : String(rowData[COL.CITY]                      || ''),
    state                   : String(rowData[COL.STATE]                     || ''),
    zip                     : String(rowData[COL.ZIP]                       || ''),
    dob                     : fmtDate(rowData[COL.DOB]),
    medId                   : String(rowData[COL.MED_ID]                    || ''),
    height                  : String(rowData[COL.HEIGHT]                    || ''),
    weight                  : String(rowData[COL.WEIGHT]                    || ''),
    shoeSize                : String(rowData[COL.SHOE_SIZE]                 || ''),
    waistSize               : String(rowData[COL.WAIST_SIZE]               || ''),
    gender                  : String(rowData[COL.GENDER]                    || ''),
    doctorName              : String(rowData[COL.DOCTOR_NAME]               || ''),
    doctorPhone             : String(rowData[COL.DOCTOR_PHONE]              || ''),
    doctorFax               : String(rowData[COL.DOCTOR_FAX]                || ''),
    doctorNpi               : String(rowData[COL.DOCTOR_NPI]                || ''),
    processingHistory       : String(rowData[COL.PROCESSING_HISTORY]        || ''),
    approvalDate            : fmtDate(rowData[COL.APPROVAL_DATE]),
    paymentStatus           : _paymentStatusFor(paymentMap, leadId),
  };
}

// ─── Dashboard stats ──────────────────────────────────────────────────────────

export async function getDashboardStats(token) {
  try {
    const sess       = await _reqAuth(token);
    const sourceData = await _getSourceData();
    let total = 0, verified = 0, orderSigned = 0, approved = 0;
    sourceData.forEach(row => {
      if (!['admin', 'closer'].includes(sess.role)) {
        if (String(row[COL.CENTER_CODE] || '').trim().toLowerCase() !==
            String(sess.centerCode || '').trim().toLowerCase()) return;
      }
      total++;
      const ls  = String(row[COL.LEAD_STATUS]               || '').trim();
      const cs  = String(row[COL.CHASER_STATUS]             || '').trim();
      const ps  = String(row[COL.PROCESSING_STATUS_CENTERS] || '').trim().toUpperCase();
      if (DISPOSITIONS.LEAD_PRODUCTION.includes(ls))                              verified++;
      if (DISPOSITIONS.CHASER_SIGNED.includes(cs))                                orderSigned++;
      if (DISPOSITIONS.PROC_APPROVED.map(v => v.toUpperCase()).includes(ps))      approved++;
    });
    return { success: true, total, verified, orderSigned, approved };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─── Leads (paginated, filtered) ─────────────────────────────────────────────

export async function getLeads(token, options) {
  try {
    const sess = await _reqAuth(token);
    const { page = 1, search = '', filters = {} } = options || {};
    const srch = search.trim().toLowerCase();

    const sourceData = await _getSourceData();
    const idMap      = await _getIdMap();
    const paymentMap = await _getPaymentStatusMap();
    const matched    = [];

    sourceData.forEach((row, idx) => {
      const sRow = idx + 2;
      if (!['admin', 'closer'].includes(sess.role)) {
        if (String(row[COL.CENTER_CODE] || '').trim().toLowerCase() !==
            String(sess.centerCode || '').trim().toLowerCase()) return;
      }
      if (srch) {
        const haystack = [
          row[COL.FIRST_NAME], row[COL.LAST_NAME], row[COL.PHONE],
          row[COL.CENTER_CODE], row[COL.LEAD_STATUS], row[COL.CHASER_STATUS],
          row[COL.LEAD_TYPE], row[COL.REQUESTED_PRODUCTS],
        ].join(' ').toLowerCase();
        if (!haystack.includes(srch)) return;
      }
      if (filters.leadStatus       && String(row[COL.LEAD_STATUS]               || '') !== filters.leadStatus)       return;
      if (filters.chaserStatus     && String(row[COL.CHASER_STATUS]             || '') !== filters.chaserStatus)     return;
      if (filters.processingStatus && String(row[COL.PROCESSING_STATUS_CENTERS] || '') !== filters.processingStatus) return;
      if (filters.centerCode && sess.role === 'admin' && String(row[COL.CENTER_CODE] || '') !== filters.centerCode)  return;
      if (filters.dateFrom || filters.dateTo) {
        const d = new Date(row[COL.DATE]);
        if (!isNaN(d)) {
          if (filters.dateFrom && d < new Date(filters.dateFrom)) return;
          if (filters.dateTo   && d > new Date(filters.dateTo))   return;
        }
      }
      matched.push({ row, sRow });
    });

    matched.sort((a, b) => {
      const da = new Date(a.row[COL.DATE]);
      const db = new Date(b.row[COL.DATE]);
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return db - da;
    });

    const total      = matched.length;
    const totalPages = Math.max(1, Math.ceil(total / CONFIG.PAGE_SIZE));
    const start      = (page - 1) * CONFIG.PAGE_SIZE;
    const slice      = matched.slice(start, start + CONFIG.PAGE_SIZE);

    await _ensureLeadIds(slice.map(({ row, sRow }) => ({ sourceRow: sRow, rowData: row })), idMap);

    const leads = slice.map(({ row, sRow }) => {
      const leadId = idMap[String(sRow)].leadId;
      return {
        leadId,
        date                    : fmtDate(row[COL.DATE]),
        fullName                : [row[COL.FIRST_NAME], row[COL.LAST_NAME]].filter(Boolean).join(' '),
        centerCode              : String(row[COL.CENTER_CODE]               || ''),
        phone                   : String(row[COL.PHONE]                     || ''),
        leadStatus              : String(row[COL.LEAD_STATUS]               || ''),
        chaserStatus            : String(row[COL.CHASER_STATUS]             || ''),
        processingStatusCenters : String(row[COL.PROCESSING_STATUS_CENTERS] || ''),
        closingNotes            : String(row[COL.CLOSING_NOTES]             || ''),
        chaserNote              : String(row[COL.CHASER_NOTE]               || ''),
        leadType                : String(row[COL.LEAD_TYPE]                 || ''),
        requestedProducts       : String(row[COL.REQUESTED_PRODUCTS]        || ''),
        approvalDate            : fmtDate(row[COL.APPROVAL_DATE]),
        paymentStatus           : _paymentStatusFor(paymentMap, leadId),
      };
    });

    await logActivity(sess.username, 'VIEW_LEADS', `Page ${page} | search="${search}"`);
    return { success: true, leads, total, page, totalPages, pageSize: CONFIG.PAGE_SIZE };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─── Lead details ─────────────────────────────────────────────────────────────

export async function getLeadDetails(token, leadId) {
  try {
    const sess       = await _reqAuth(token);
    const sourceData = await _getSourceData();
    const idMap      = await _getIdMap();

    let foundRowData = null, foundSourceRow = null;
    for (const [sourceRowKey, entry] of Object.entries(idMap)) {
      if (entry.leadId === leadId) {
        const idx = parseInt(sourceRowKey) - 2;
        if (idx >= 0 && idx < sourceData.length) {
          foundRowData   = sourceData[idx];
          foundSourceRow = parseInt(sourceRowKey);
        }
        break;
      }
    }
    if (!foundRowData) return { success: false, error: 'Lead not found.' };

    const paymentMap = await _getPaymentStatusMap();
    const lead  = await _rowToLead(foundRowData, foundSourceRow, idMap, paymentMap);
    const notes = await _getLeadNotes(leadId);
    await logActivity(sess.username, 'VIEW_LEAD', `Lead: ${leadId}`);
    return { success: true, lead, notes };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─── Notes ───────────────────────────────────────────────────────────────────

export async function addNote(token, leadId, content) {
  try {
    const sess = await _reqAuth(token);
    if (!content || !content.trim()) return { success: false, error: 'Note content cannot be empty.' };

    const mapSheet = await getCrmSheet(SHEETS.LEAD_ID_MAP);
    const mapRows  = await mapSheet.getValues();
    let authorised = false;
    for (let i = 1; i < mapRows.length; i++) {
      if (mapRows[i][1] === leadId) {
        authorised = sess.role === 'admin' ||
          sess.role === 'closer' ||
          String(mapRows[i][2] || '').trim().toLowerCase() === String(sess.centerCode || '').trim().toLowerCase();
        break;
      }
    }
    if (!authorised) return { success: false, error: 'Access denied.' };

    const notesSheet = await getCrmSheet(SHEETS.NOTES_LOG);
    await notesSheet.appendRow([now(), leadId, sess.centerCode, content.trim(), sess.username]);
    await logActivity(sess.username, 'ADD_NOTE', `Note on lead: ${leadId}`);
    return { success: true, timestamp: now() };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function setLeadPaymentStatus(token, leadId, status = 'Paid') {
  try {
    const sess = await _reqAdmin(token);
    const cleanLeadId = String(leadId || '').trim();
    const cleanStatus = String(status || 'Paid').trim();
    if (!cleanLeadId) return { success: false, error: 'Missing lead ID.' };
    if (!['Paid', 'Unpaid'].includes(cleanStatus)) return { success: false, error: 'Invalid payment status.' };

    const sheet = await _getPaymentSheet();
    const rows = await sheet.getValues();
    let targetRow = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() === cleanLeadId) {
        targetRow = i + 1;
        break;
      }
    }

    const updatedAt = now();
    if (targetRow > 0) {
      await sheet.setCell(targetRow, 2, cleanStatus);
      await sheet.setCell(targetRow, 3, sess.username);
      await sheet.setCell(targetRow, 4, updatedAt);
    } else {
      await sheet.appendRow([cleanLeadId, cleanStatus, sess.username, updatedAt]);
    }

    await cache.remove('payment_status_rows');
    await logActivity(sess.username, 'UPDATE_PAYMENT_STATUS', `${cleanLeadId}: ${cleanStatus}`);
    return { success: true, leadId: cleanLeadId, paymentStatus: cleanStatus };
  } catch (e) { return { success: false, error: e.message }; }
}

async function _getLeadNotes(leadId) {
  const sheet = await getCrmSheet(SHEETS.NOTES_LOG);
  const rows  = await sheet.getValues();
  const notes = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === leadId) {
      notes.push({ timestamp: rows[i][0], leadId: rows[i][1], centerCode: rows[i][2], content: rows[i][3], createdBy: rows[i][4] });
    }
  }
  return notes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function getNotifications(token) {
  try {
    const sess  = await _reqAuth(token);
    const sheet = await getCrmSheet(SHEETS.NOTIFICATIONS);
    const rows  = await sheet.getValues();
    const notifs = [];
    const adminBroadcastSeen = new Set();
    for (let i = 1; i < rows.length; i++) {
      const centerCode = String(rows[i][1] || '');
      const messageRaw = rows[i][3];
      const parsedMsg = _parseNotificationMessage(messageRaw);
      if (parsedMsg?.type !== 'broadcast') continue;
      if (sess.role === 'admin' && parsedMsg?.type === 'broadcast') {
        const key = `${rows[i][5]}|${messageRaw}`;
        if (adminBroadcastSeen.has(key)) continue;
        adminBroadcastSeen.add(key);
        notifs.push({
          id        : String(rows[i][0]),
          centerCode,
          leadId    : rows[i][2],
          messageRaw,
          status    : 'Read',
          timestamp : rows[i][5],
          rowIndex  : i + 1,
        });
        continue;
      }
      if (sess.role !== 'admin' &&
          centerCode.trim().toLowerCase() !== String(sess.centerCode || '').trim().toLowerCase()) continue;
      notifs.push({
        id        : String(rows[i][0]),
        centerCode,
        leadId    : rows[i][2],
        messageRaw,
        status    : rows[i][4],
        timestamp : rows[i][5],
        rowIndex  : i + 1,
      });
    }
    notifs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return {
      success     : true,
      notifications: notifs.slice(0, 100),
      unreadCount : notifs.filter(n => n.status === 'Unread').length,
    };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function sendAdminNotification(token, audience, title, body) {
  try {
    const sess = await _reqAdmin(token);
    const cleanAudience = String(audience || 'both').trim().toLowerCase();
    const cleanTitle = String(title || '').trim();
    const cleanBody = String(body || '').trim();
    if (!['closers', 'centers', 'both'].includes(cleanAudience)) {
      return { success: false, error: 'Invalid audience.' };
    }
    if (!cleanTitle && !cleanBody) return { success: false, error: 'Notification message is required.' };

    const usersSheet = await getCrmSheet(SHEETS.USERS);
    const users = await usersSheet.getValues();
    const allowedRoles = cleanAudience === 'both' ? ['closer', 'center'] :
      cleanAudience === 'closers' ? ['closer'] : ['center'];
    const recipients = [];
    const seen = new Set();

    for (let i = 1; i < users.length; i++) {
      const username = String(users[i][0] || '').trim();
      const role = String(users[i][2] || '').trim().toLowerCase();
      const status = String(users[i][3] || '').trim().toLowerCase();
      if (!username || status !== 'active' || !allowedRoles.includes(role)) continue;
      const key = username.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push({ username, role });
    }

    if (recipients.length === 0) return { success: false, error: 'No active recipients found.' };

    const msgObj = {
      type: 'broadcast',
      title: cleanTitle || 'Admin Notification',
      body: cleanBody,
      audience: cleanAudience,
      sentBy: sess.username,
    };
    const notifSheet = await getCrmSheet(SHEETS.NOTIFICATIONS);
    const timestamp = now();
    await Promise.all(recipients.map(recipient =>
      notifSheet.appendRow([generateId('N'), recipient.username, '', JSON.stringify(msgObj), 'Unread', timestamp])
    ));

    await logActivity(sess.username, 'SEND_NOTIFICATION', `${cleanAudience}: ${recipients.length} recipients`);
    return { success: true, recipients: recipients.length };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function markNotificationRead(token, notificationId) {
  try {
    const sess  = await _reqAuth(token);
    const sheet = await getCrmSheet(SHEETS.NOTIFICATIONS);
    const rows  = await sheet.getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(notificationId)) {
        const parsedMsg = _parseNotificationMessage(rows[i][3]);
        if (sess.role === 'admin' && parsedMsg?.type === 'broadcast') return { success: true };
        if (sess.role !== 'admin' &&
            String(rows[i][1] || '').trim().toLowerCase() !== String(sess.centerCode || '').trim().toLowerCase())
          return { success: false, error: 'Access denied.' };
        await sheet.setCell(i + 1, 5, 'Read');
        return { success: true };
      }
    }
    return { success: false, error: 'Notification not found.' };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function markAllNotificationsRead(token) {
  try {
    const sess  = await _reqAuth(token);
    const sheet = await getCrmSheet(SHEETS.NOTIFICATIONS);
    const rows  = await sheet.getValues();
    const updates = [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][4] === 'Unread') {
        const cc = String(rows[i][1] || '');
        const parsedMsg = _parseNotificationMessage(rows[i][3]);
        if (sess.role === 'admin' && parsedMsg?.type === 'broadcast') continue;
        if (sess.role === 'admin' || cc.trim().toLowerCase() === String(sess.centerCode || '').trim().toLowerCase()) {
          updates.push(sheet.setCell(i + 1, 5, 'Read'));
        }
      }
    }
    await Promise.all(updates);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─── Filter options ───────────────────────────────────────────────────────────

export async function getFilterOptions(token) {
  try {
    const sess       = await _reqAuth(token);
    const sourceData = await _getSourceData();
    const lsSet = new Set(), csSet = new Set(), psSet = new Set(), ccSet = new Set();
    sourceData.forEach(row => {
      if (!['admin', 'closer'].includes(sess.role)) {
        if (String(row[COL.CENTER_CODE] || '').trim().toLowerCase() !==
            String(sess.centerCode || '').trim().toLowerCase()) return;
      }
      if (row[COL.LEAD_STATUS])               lsSet.add(String(row[COL.LEAD_STATUS]));
      if (row[COL.CHASER_STATUS])             csSet.add(String(row[COL.CHASER_STATUS]));
      if (row[COL.PROCESSING_STATUS_CENTERS]) psSet.add(String(row[COL.PROCESSING_STATUS_CENTERS]));
      if (['admin', 'closer'].includes(sess.role) && row[COL.CENTER_CODE]) ccSet.add(String(row[COL.CENTER_CODE]));
    });
    return {
      success           : true,
      leadStatuses      : [...lsSet].filter(Boolean).sort(),
      chaserStatuses    : [...csSet].filter(Boolean).sort(),
      processingStatuses: [...psSet].filter(Boolean).sort(),
      centerCodes       : ['admin', 'closer'].includes(sess.role) ? [...ccSet].filter(Boolean).sort() : [],
    };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─── PCP ─────────────────────────────────────────────────────────────────────

export async function getPcpStats(token) {
  try {
    const sess = await _reqAuth(token);
    const data = await _getPcpSourceData();
    let total = 0, approved = 0, inProcess = 0, denied = 0;
    data.forEach(row => {
      if (!['admin', 'closer'].includes(sess.role)) {
        if (String(row[PCP_COL.CENTER_CODE] || '').trim().toLowerCase() !==
            String(sess.centerCode || '').trim().toLowerCase()) return;
      }
      total++;
      const ps = String(row[PCP_COL.PROC_STATUS_CENTERS] || '').trim().toUpperCase();
      if (ps === 'APPROVED')   approved++;
      if (ps === 'IN PROCESS') inProcess++;
      if (ps === 'DENIED')     denied++;
    });
    return { success: true, total, approved, inProcess, denied };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function getPcpLeads(token, options) {
  try {
    const sess = await _reqAuth(token);
    const { page = 1, search = '', filters = {} } = options || {};
    const srch = search.trim().toLowerCase();
    const data = await _getPcpSourceData();
    const paymentMap = await _getPaymentStatusMap();
    const matched = [];

    data.forEach((row, idx) => {
      if (!['admin', 'closer'].includes(sess.role)) {
        if (String(row[PCP_COL.CENTER_CODE] || '').trim().toLowerCase() !==
            String(sess.centerCode || '').trim().toLowerCase()) return;
      }
      if (srch) {
        const hay = [
          row[PCP_COL.FIRST_NAME], row[PCP_COL.LAST_NAME],
          row[PCP_COL.PHONE],      row[PCP_COL.CENTER_CODE],
          row[PCP_COL.LEAD_TYPE],  row[PCP_COL.REQUESTED_PRODUCTS],
          row[PCP_COL.DOCa_REVIEW], row[PCP_COL.PROC_STATUS_CENTERS],
        ].join(' ').toLowerCase();
        if (!hay.includes(srch)) return;
      }
      if (filters.procStatus && String(row[PCP_COL.PROC_STATUS_CENTERS] || '') !== filters.procStatus) return;
      if (filters.centerCode && ['admin', 'closer'].includes(sess.role) &&
          String(row[PCP_COL.CENTER_CODE] || '') !== filters.centerCode) return;
      matched.push({ row, sRow: idx + 2 });
    });

    matched.sort((a, b) => {
      const da = new Date(a.row[PCP_COL.TIMESTAMP]);
      const db = new Date(b.row[PCP_COL.TIMESTAMP]);
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return db - da;
    });

    const total      = matched.length;
    const totalPages = Math.max(1, Math.ceil(total / CONFIG.PAGE_SIZE));
    const start      = (page - 1) * CONFIG.PAGE_SIZE;
    const leads      = matched.slice(start, start + CONFIG.PAGE_SIZE).map(({ row, sRow }) => ({
      sRow,
      paymentId        : _pcpPaymentId(sRow),
      timestamp        : fmtDate(row[PCP_COL.TIMESTAMP], 'MM/dd/yyyy'),
      centerCode       : String(row[PCP_COL.CENTER_CODE]         || ''),
      fullName         : [row[PCP_COL.FIRST_NAME], row[PCP_COL.LAST_NAME]].filter(Boolean).join(' '),
      phone            : String(row[PCP_COL.PHONE]               || ''),
      leadType         : String(row[PCP_COL.LEAD_TYPE]           || ''),
      requestedProducts: String(row[PCP_COL.REQUESTED_PRODUCTS]  || ''),
      backendStatus    : String(row[PCP_COL.DOCa_REVIEW]         || ''),
      backendNote      : String(row[PCP_COL.NOTE]                || ''),
      procStatusCenters: String(row[PCP_COL.PROC_STATUS_CENTERS] || ''),
      processingHistory: String(row[PCP_COL.PROCESSING_HISTORY]  || ''),
      shippedDate      : fmtDate(row[PCP_COL.SHIPPED_DATE], 'MM/dd/yyyy'),
      paymentStatus    : _paymentStatusFor(paymentMap, _pcpPaymentId(sRow)),
    }));

    await logActivity(sess.username, 'VIEW_PCP', `Page ${page} search="${search}"`);
    return { success: true, leads, total, page, totalPages, pageSize: CONFIG.PAGE_SIZE };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function getPcpLeadDetails(token, sRow) {
  try {
    const sess = await _reqAuth(token);
    const data = await _getPcpSourceData();
    const idx  = parseInt(sRow) - 2;
    if (idx < 0 || idx >= data.length) return { success: false, error: 'Record not found.' };
    const row = data[idx];
    if (!['admin', 'closer'].includes(sess.role)) {
      if (String(row[PCP_COL.CENTER_CODE] || '').trim().toLowerCase() !==
          String(sess.centerCode || '').trim().toLowerCase())
        return { success: false, error: 'Access denied.' };
    }
    const paymentMap = await _getPaymentStatusMap();
    return {
      success: true,
      lead: {
        sRow,
        paymentId        : _pcpPaymentId(sRow),
        timestamp        : fmtDate(row[PCP_COL.TIMESTAMP], 'yyyy-MM-dd HH:mm'),
        centerCode       : String(row[PCP_COL.CENTER_CODE]         || ''),
        centerName       : String(row[PCP_COL.CENTER_NAME]         || ''),
        closerName       : String(row[PCP_COL.CLOSER_NAME]         || ''),
        procStatusCenters: String(row[PCP_COL.PROC_STATUS_CENTERS] || ''),
        backendStatus    : String(row[PCP_COL.DOCa_REVIEW]         || ''),
        snsResult        : String(row[PCP_COL.SNS_RESULT]          || ''),
        leadType         : String(row[PCP_COL.LEAD_TYPE]           || ''),
        requestedProducts: String(row[PCP_COL.REQUESTED_PRODUCTS]  || ''),
        firstName        : String(row[PCP_COL.FIRST_NAME]          || ''),
        lastName         : String(row[PCP_COL.LAST_NAME]           || ''),
        phone            : String(row[PCP_COL.PHONE]               || ''),
        gender           : String(row[PCP_COL.GENDER]              || ''),
        address          : String(row[PCP_COL.ADDRESS]             || ''),
        city             : String(row[PCP_COL.CITY]                || ''),
        state            : String(row[PCP_COL.STATE]               || ''),
        zip              : String(row[PCP_COL.ZIP]                 || ''),
        dob              : fmtDate(row[PCP_COL.DOB]),
        medId            : String(row[PCP_COL.MED_ID]              || ''),
        height           : String(row[PCP_COL.HEIGHT]              || ''),
        weight           : String(row[PCP_COL.WEIGHT]              || ''),
        shoeSize         : String(row[PCP_COL.SHOE_SIZE]           || ''),
        waistSize        : String(row[PCP_COL.WAIST_SIZE]          || ''),
        doctorName       : String(row[PCP_COL.DOCTOR_NAME]         || ''),
        doctorNpi        : String(row[PCP_COL.DOCTOR_NPI]          || ''),
        doctorPhone      : String(row[PCP_COL.DOCTOR_PHONE]        || ''),
        doctorFax        : String(row[PCP_COL.DOCTOR_FAX]          || ''),
        doctorAddress    : String(row[PCP_COL.DOCTOR_ADDRESS]       || ''),
        doLink           : String(row[PCP_COL.DO_LINK]             || ''),
        cnLink           : String(row[PCP_COL.CN_LINK]             || ''),
        recordLink       : String(row[PCP_COL.RECORD_LINK]         || ''),
        note             : String(row[PCP_COL.NOTE]                || ''),
        processingHistory: String(row[PCP_COL.PROCESSING_HISTORY]  || ''),
        shippedDate      : fmtDate(row[PCP_COL.SHIPPED_DATE]),
        paymentStatus    : _paymentStatusFor(paymentMap, _pcpPaymentId(sRow)),
      },
    };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─── Insights ─────────────────────────────────────────────────────────────────

const RTS_WARNING_PCT = 15;
const RTS_TARGET_LOW  = 7;
const RTS_TARGET_HIGH = 15;
const ORDER_TARGET_LOW  = 25;
const ORDER_TARGET_HIGH = 30;

function _buildWeekBuckets() {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const today  = new Date();
  today.setHours(0, 0, 0, 0);
  const day = today.getDay();
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  return [6, 5, 4, 3, 2, 1, 0].map(weeksBack => {
    const start = new Date(thisMonday);
    start.setDate(thisMonday.getDate() - weeksBack * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    const label = MONTHS[start.getMonth()] + ' ' + start.getDate() +
                  '–' + MONTHS[end.getMonth()] + ' ' + end.getDate();
    return { start, end, label, count: 0 };
  });
}

export async function getInsightsData(token, dateFrom, dateTo) {
  try {
    const sess       = await _reqAuth(token);
    const sourceData = await _getSourceData();

    const leadStatusDist       = {};
    const chaserStatusDist     = {};
    const processingStatusDist = {};
    const leadsOverTime        = {};
    const centerStats          = {};
    const centerPerformance    = {};

    let total = 0, verified = 0, trash_ls = 0;
    let orderSigned = 0, highPotential = 0, trash_cs = 0;
    let approved = 0, inProcess = 0, denied = 0, rts = 0;
    let returnedDOs = 0, rtsFromReturned = 0, approvedFromReturned = 0;
    let verifiedWithin45 = 0, notReturnedWithin45 = 0;
    let leadsOlderThan45 = 0, orderSignedOlderThan45 = 0;      let verifiedMedB = 0, verifiedPPO = 0;
      let verifiedOlderThan45 = 0, staleVerifiedCount = 0;
      const droppedByDisposition = {};
    const cutoff45 = new Date();
    cutoff45.setDate(cutoff45.getDate() - 45);
    cutoff45.setHours(0, 0, 0, 0);

    const lgWeekBuckets = _buildWeekBuckets();

    sourceData.forEach(row => {
      if (!['admin', 'closer'].includes(sess.role)) {
        if (String(row[COL.CENTER_CODE] || '').trim().toLowerCase() !==
            String(sess.centerCode || '').trim().toLowerCase()) return;
      }
      const rowDate = row[COL.DATE] ? new Date(row[COL.DATE]) : null;
      if (dateFrom || dateTo) {
        if (rowDate && !isNaN(rowDate)) {
          if (dateFrom && rowDate < new Date(dateFrom)) return;
          if (dateTo   && rowDate > new Date(dateTo))   return;
        }
      }

      total++;
      const ls  = String(row[COL.LEAD_STATUS]               || '').trim();
      const cs  = String(row[COL.CHASER_STATUS]             || '').trim();
      const ps  = String(row[COL.PROCESSING_STATUS_CENTERS] || '').trim();
      const cc  = String(row[COL.CENTER_CODE]               || 'No Update');
      const psU = ps.toUpperCase();
      if (!centerPerformance[cc]) {
        centerPerformance[cc] = {
          centerCode: cc,
          total: 0,
          verified: 0,
          dropped: 0,
          signed: 0,
          approved: 0,
          rts: 0,
          staleVerified: 0,
        };
      }
      const center = centerPerformance[cc];

      leadStatusDist[ls || 'No Update']       = (leadStatusDist[ls || 'No Update']       || 0) + 1;
      chaserStatusDist[cs || 'No Update']     = (chaserStatusDist[cs || 'No Update']     || 0) + 1;
      processingStatusDist[ps || 'No Update'] = (processingStatusDist[ps || 'No Update'] || 0) + 1;
      centerStats[cc] = (centerStats[cc] || 0) + 1;
      center.total++;

      const isVerified = DISPOSITIONS.LEAD_PRODUCTION.includes(ls);
      const isReturned = DISPOSITIONS.CHASER_SIGNED.includes(cs);
      const isRTS      = psU === 'SHIPPED RTS';
      const isApproved = psU === 'APPROVED';

      if (isVerified) {
        verified++;
        center.verified++;
        if (ls === 'Verified Med b') verifiedMedB++;
        else if (ls === 'Verified ppo') verifiedPPO++;
      } else {
        trash_ls++;
        center.dropped++;
        if (ls) droppedByDisposition[ls] = (droppedByDisposition[ls] || 0) + 1;
      }

      if (isReturned) {
        orderSigned++; returnedDOs++;
        center.signed++;
        if (isRTS)      rtsFromReturned++;
        if (isApproved) approvedFromReturned++;
      } else if (DISPOSITIONS.CHASER_POTENTIAL.includes(cs)) {
        highPotential++;
      } else if (cs) {
        trash_cs++;
      }

      if (isApproved)           approved++;
      else if (psU === 'IN PROCESS') inProcess++;
      else if (psU === 'DENIED')     denied++;
      else if (isRTS)                rts++;
      if (isApproved) center.approved++;
      if (isRTS)      center.rts++;

      if (isVerified && rowDate && !isNaN(rowDate) && rowDate >= cutoff45) {
        verifiedWithin45++;
        if (!isReturned) notReturnedWithin45++;
      }
      if (rowDate && !isNaN(rowDate) && rowDate < cutoff45) {
        leadsOlderThan45++;
        if (isReturned) orderSignedOlderThan45++;
        if (isVerified) {
          verifiedOlderThan45++;
          if (!isReturned) {
            staleVerifiedCount++;
            center.staleVerified++;
          }
        }
      }
      if (rowDate && !isNaN(rowDate)) {
        for (const b of lgWeekBuckets) {
          if (rowDate >= b.start && rowDate <= b.end) { b.count++; break; }
        }
        const key = `${rowDate.getFullYear()}-${String(rowDate.getMonth()+1).padStart(2,'0')}`;
        leadsOverTime[key] = (leadsOverTime[key] || 0) + 1;
      }
    });

    const timeLabels        = Object.keys(leadsOverTime).sort();
    const rtsRate           = returnedDOs > 0 ? Math.round((rtsFromReturned / returnedDOs) * 100) : 0;
    const prodRate          = total > 0        ? Math.round((verified  / total)             * 100) : 0;
    const orderConversionRate = leadsOlderThan45 > 0
      ? Math.round((orderSignedOlderThan45 / leadsOlderThan45) * 100)
      : null;
    const centerPerformanceRows = Object.values(centerPerformance)
      .map(c => ({
        ...c,
        productionRate: c.total > 0 ? Math.round((c.verified / c.total) * 100) : 0,
        signedRate    : c.verified > 0 ? Math.round((c.signed / c.verified) * 100) : 0,
        approvalRate  : c.signed > 0 ? Math.round((c.approved / c.signed) * 100) : 0,
        rtsRate       : c.signed > 0 ? Math.round((c.rts / c.signed) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    // PCP
    const pcpData        = await _getPcpSourceData();
    const pcpWeekBuckets = _buildWeekBuckets();
    let pcpTotal = 0, pcpApproved = 0, pcpDenied = 0, pcpRts = 0;

    pcpData.forEach(row => {
      if (!['admin', 'closer'].includes(sess.role)) {
        if (String(row[PCP_COL.CENTER_CODE] || '').trim().toLowerCase() !==
            String(sess.centerCode || '').trim().toLowerCase()) return;
      }
      const pDate = row[PCP_COL.TIMESTAMP] ? new Date(row[PCP_COL.TIMESTAMP]) : null;
      if (dateFrom || dateTo) {
        if (pDate && !isNaN(pDate)) {
          if (dateFrom && pDate < new Date(dateFrom)) return;
          if (dateTo   && pDate > new Date(dateTo))   return;
        }
      }
      pcpTotal++;
      const pStatus = String(row[PCP_COL.PROC_STATUS_CENTERS] || '').trim().toUpperCase();
      if (pStatus === 'APPROVED')    pcpApproved++;
      if (pStatus === 'DENIED')      pcpDenied++;
      if (pStatus === 'SHIPPED RTS') pcpRts++;
      if (pDate && !isNaN(pDate)) {
        for (const b of pcpWeekBuckets) {
          if (pDate >= b.start && pDate <= b.end) { b.count++; break; }
        }
      }
    });

    return {
      success: true,
      totalLeads: total,
      leadStatusDist, chaserStatusDist, processingStatusDist, centerStats,
      centerPerformance: centerPerformanceRows,
      leadsOverTime: { labels: timeLabels, data: timeLabels.map(k => leadsOverTime[k]) },
      production: {
        verified, trash: trash_ls, prodRate,
        orderSigned, highPotential, trash_cs,
        approved, inProcess, denied, rts,
        returnedDOs, rtsFromReturned, approvedFromReturned,
        verifiedWithin45, notReturnedWithin45,
        rtsRate,
        rtsWarning: rtsRate > RTS_WARNING_PCT,
        orderConversionRate,
        leadsOlderThan45, orderSignedOlderThan45,
        verifiedMedB, verifiedPPO,
        droppedByDisposition,
        verifiedOlderThan45, staleVerifiedCount,
        orderTargetLow: ORDER_TARGET_LOW, orderTargetHigh: ORDER_TARGET_HIGH,
        rtsTargetLow: RTS_TARGET_LOW,     rtsTargetHigh: RTS_TARGET_HIGH,
      },
      weeklyLG : lgWeekBuckets.map(b  => ({ label: b.label,  count: b.count  })),
      pcp      : { total: pcpTotal, approved: pcpApproved, denied: pcpDenied, rts: pcpRts },
      weeklyPCP: pcpWeekBuckets.map(b => ({ label: b.label, count: b.count })),
    };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─── Change detection ─────────────────────────────────────────────────────────

export async function runChangeDetection(token) {
  try {
    await _reqAuth(token);
    return _runChangeDetectionInternal();
  } catch (e) { return { success: false, error: e.message }; }
}

export async function runChangeDetectionInternal() {
  return _runChangeDetectionInternal();
}

async function _runChangeDetectionInternal() {
  const sourceData = await _getSourceData();
  const idMap      = await _getIdMap();
  const mapSheet   = await getCrmSheet(SHEETS.LEAD_ID_MAP);
  const auditSheet = await getCrmSheet(SHEETS.AUDIT_LOG);
  const notifSheet = await getCrmSheet(SHEETS.NOTIFICATIONS);
  let newNotifications = 0;

  for (const [idx, row] of sourceData.entries()) {
    const sourceRow   = idx + 2;
    const currentHash = _watchHash(row);

    if (idMap[sourceRow]) {
      const existing = idMap[sourceRow];
      if (existing.watchHash !== currentHash) {
        const leadId     = existing.leadId;
        const centerCode = String(row[COL.CENTER_CODE] || '');
        const prevVals   = existing.watchValuesJson ? JSON.parse(existing.watchValuesJson) : {};
        const currVals   = _watchValues(row);
        const changes    = [];

        for (const f of WATCHED_FIELDS) {
          const oldV = prevVals[f.name] || '';
          const newV = currVals[f.name] || '';
          if (oldV !== newV) {
            changes.push({ field: f.name, from: oldV, to: newV });
            await auditSheet.appendRow([now(), leadId, f.name, oldV, newV, 'SYSTEM']);
          }
        }

        if (changes.length) {
          const msgObj  = { changes: changes.filter(c => c.to) };
          const notifId = generateId('N');
          await notifSheet.appendRow([notifId, centerCode, leadId, JSON.stringify(msgObj), 'Unread', now()]);
          newNotifications++;
        }

        if (existing.mapRow) {
          await mapSheet.setRange(existing.mapRow, 4, [[currentHash, JSON.stringify(currVals)]]);
        }
      }
    } else {
      await _ensureLeadId(sourceRow, row, idMap);
    }
  }

  _invalidateSourceCache();
  return { success: true, newNotifications };
}

// ─── Audit log ────────────────────────────────────────────────────────────────

export async function getAuditLog(token, leadId) {
  try {
    await _reqAdmin(token);
    const sheet = await getCrmSheet(SHEETS.AUDIT_LOG);
    const rows  = await sheet.getValues();
    const logs  = rows.slice(1)
      .filter(r => !leadId || r[1] === leadId)
      .reverse().slice(0, 200)
      .map(r => ({ timestamp: r[0], leadId: r[1], fieldName: r[2], oldValue: r[3], newValue: r[4], changedBy: r[5] }));
    return { success: true, logs };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─── App config ───────────────────────────────────────────────────────────────

export async function getAppConfig(token) {
  try {
    await _reqAuth(token);
    return { success: true, webformUrl: CONFIG.WEBFORM_URL };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─── Criteria List ────────────────────────────────────────────────────────────
// Reads the "Criteria List" sheet from the source spreadsheet.
// Columns (0-based, A=0):
//  A(0)  Active checkbox (TRUE/FALSE)
//  B(1)  Supplier Nick Name
//  C(2)  Campaign Type  (LG / PCP / Both)
//  D(3)  Accepted Plans (Med B / PPO / Both)
//  E(4)  Plans Available (comma-sep names)
//  F(5)  Good States     (comma-sep 2-letter abbr)
//  G(6)  Age Limit       (e.g. "1939 +")
//  H(7)  Sending Type    (Posting / Live Transfer)
//  I(8)  HCPCS Codes     (comma-sep pairs like "BB - L0456, KB - L1833")
//  J(9)  Combos Accepted (comma-sep combos)
//  K(10) Supplier Note   (long text)
//  L(11) Transfer Number (shown only for Live Transfer)

const CRITERIA_SHEET_NAME = 'Criteria List';

export async function getCriteriaList(token) {
  try {
    await _reqAuth(token);

    const KEY = 'criteria_list_v1';
    const hit = await cache.get(KEY);
    if (hit) return { success: true, data: hit };

    const ss   = getSourceSpreadsheet();
    const rows = await ss.getValues(CRITERIA_SHEET_NAME);

    if (!rows || rows.length <= 1) {
      return { success: true, data: [] };
    }

    const data = rows.slice(1)
      .filter(r => r.some(c => c !== '' && c !== null && c !== undefined))
      .map(r => {
        const active       = String(r[0] || '').trim().toUpperCase() === 'TRUE';
        const supplierName = String(r[1] || '').trim();
        const campaignType = String(r[2] || '').trim();
        const acceptedPlans= String(r[3] || '').trim();
        const plansAvailable=String(r[4] || '').trim();
        const goodStates   = String(r[5] || '').trim();
        const ageLimit     = String(r[6] || '').trim();
        const sendingType  = String(r[7] || '').trim();
        const hcpcsCodes   = String(r[8] || '').trim();
        const combosAccepted=String(r[9] || '').trim();
        const supplierNote = String(r[10]|| '').trim();
        const transferNumber=String(r[11]|| '').trim();
        return {
          active, supplierName, campaignType, acceptedPlans,
          plansAvailable, goodStates, ageLimit, sendingType,
          hcpcsCodes, combosAccepted, supplierNote, transferNumber,
        };
      });

    await cache.set(KEY, data, CONFIG.CACHE_TTL_SEC);
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── Centers / Center Card ───────────────────────────────────────────────────
// Reads a sheet named 'Center Card' from the source spreadsheet.
// Expected columns (0-based):
// A(0) Center Code, B(1) Center Name, ... F(5) Signed Agreement, G(6) Phone, H(7) Email, I(8) Country, J(9) Payment Method
export async function getCenters(token) {
  try {
    const sess = await _reqAuth(token);
    const KEY = 'center_card_rows_v1';
    const hit = await cache.get(KEY);
    let rows;
    if (hit) {
      rows = hit;
    } else {
      const sheet = await getCrmSheet(SHEETS.CENTER_CARD);
      const all = await sheet.getValues();
      rows = (all && all.length > 1) ? all.slice(1).filter(r => r.some(c => c !== '' && c !== null && c !== undefined)) : [];
      await cache.set(KEY, rows, CONFIG.CACHE_TTL_SEC);
    }

    const centers = rows.map(r => {
      return {
        centerCode      : String(r[0] || '').trim(),
        centerName      : String(r[1] || '').trim(),
        signedAgreement : String(r[5] || '').trim(),
        phone           : String(r[6] || '').trim(),
        email           : String(r[7] || '').trim(),
        country         : String(r[8] || '').trim(),
        paymentMethod   : String(r[9] || '').trim(),
        rawRow          : r,
      };
    });

    // If non-admin, restrict to the session centerCode
    const visible = (['admin'].includes(sess.role)) ? centers : centers.filter(c => String(c.centerCode || '').trim().toLowerCase() === String(sess.centerCode || '').trim().toLowerCase());

    await logActivity(sess.username, 'VIEW_CENTERS', `Retrieved ${visible.length} centers`);
    return { success: true, centers: visible };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
