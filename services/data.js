// services/data.js — Port of DataService.gs
// Leads, PCP, dashboard stats, insights, notifications, change detection, audit log.

import { getCrmSheet, getSourceSpreadsheet } from '../lib/sheets.js';
import { requireAuth as _reqAuth, requireAdmin as _reqAdmin } from '../lib/auth.js';
import { cache } from '../lib/cache.js';
import { md5, generateId, generateLeadId, now, formatDate as fmtDate } from '../lib/utils.js';
import { CONFIG, SHEETS, COL, PCP_COL, PCP_SOURCE_SHEET_NAME, DISPOSITIONS, WATCHED_FIELDS } from '../lib/config.js';
import { logActivity } from './auth.js';

// ─── Source data (cached in-process) ─────────────────────────────────────────

async function _getSourceData() {
  const KEY = 'src_data_v3';
  const hit = cache.get(KEY);
  if (hit) return hit;

  const ss    = getSourceSpreadsheet();
  const allRows = await ss.getValues(CONFIG.SOURCE_SHEET_NAME);
  if (allRows.length <= 1) return [];
  const data = allRows.slice(1).filter(r => r.some(c => c !== ''));
  cache.set(KEY, data, CONFIG.CACHE_TTL_SEC);
  return data;
}

function _invalidateSourceCache() {
  cache.remove('src_data_v3');
}

async function _getPcpSourceData() {
  const KEY = 'pcp_data_v1';
  const hit = cache.get(KEY);
  if (hit) return hit;

  const ss      = getSourceSpreadsheet();
  const allRows = await ss.getValues(PCP_SOURCE_SHEET_NAME);
  if (allRows.length <= 1) return [];
  const data = allRows.slice(1).filter(r => r.some(c => c !== ''));
  cache.set(KEY, data, CONFIG.CACHE_TTL_SEC);
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

function _watchHash(rowData) {
  return md5(WATCHED_FIELDS.map(f => String(rowData[f.col] || '')).join('|'));
}

function _watchValues(rowData) {
  const obj = {};
  WATCHED_FIELDS.forEach(f => { obj[f.name] = String(rowData[f.col] || ''); });
  return obj;
}

// ─── Row → lead object ────────────────────────────────────────────────────────

async function _rowToLead(rowData, sourceRow, idMap) {
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
          row[COL.CENTER_CODE], row[COL.LEAD_STATUS], row[COL.CHASER_STATUS], row[COL.LEAD_TYPE],
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

    const leads = await Promise.all(slice.map(async ({ row, sRow }) => {
      const leadId = await _ensureLeadId(sRow, row, idMap);
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
      };
    }));

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

    const lead  = await _rowToLead(foundRowData, foundSourceRow, idMap);
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
    for (let i = 1; i < rows.length; i++) {
      const centerCode = String(rows[i][1] || '');
      if (sess.role !== 'admin' &&
          centerCode.trim().toLowerCase() !== String(sess.centerCode || '').trim().toLowerCase()) continue;
      notifs.push({
        id        : String(rows[i][0]),
        centerCode,
        leadId    : rows[i][2],
        messageRaw: rows[i][3],
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

export async function markNotificationRead(token, notificationId) {
  try {
    const sess  = await _reqAuth(token);
    const sheet = await getCrmSheet(SHEETS.NOTIFICATIONS);
    const rows  = await sheet.getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(notificationId)) {
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
          row[PCP_COL.LEAD_TYPE],
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
      timestamp        : fmtDate(row[PCP_COL.TIMESTAMP], 'MM/dd/yyyy'),
      centerCode       : String(row[PCP_COL.CENTER_CODE]         || ''),
      fullName         : [row[PCP_COL.FIRST_NAME], row[PCP_COL.LAST_NAME]].filter(Boolean).join(' '),
      phone            : String(row[PCP_COL.PHONE]               || ''),
      leadType         : String(row[PCP_COL.LEAD_TYPE]           || ''),
      procStatusCenters: String(row[PCP_COL.PROC_STATUS_CENTERS] || ''),
      snsResult        : String(row[PCP_COL.SNS_RESULT]          || ''),
      procStatusAN     : String(row[PCP_COL.PROC_STATUS_AN]      || ''),
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
    return {
      success: true,
      lead: {
        sRow,
        timestamp        : fmtDate(row[PCP_COL.TIMESTAMP], 'yyyy-MM-dd HH:mm'),
        centerCode       : String(row[PCP_COL.CENTER_CODE]         || ''),
        centerName       : String(row[PCP_COL.CENTER_NAME]         || ''),
        closerName       : String(row[PCP_COL.CLOSER_NAME]         || ''),
        procStatusCenters: String(row[PCP_COL.PROC_STATUS_CENTERS] || ''),
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
        procStatusAN     : String(row[PCP_COL.PROC_STATUS_AN]      || ''),
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
  return [2, 1, 0].map(weeksBack => {
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

    let total = 0, verified = 0, trash_ls = 0;
    let orderSigned = 0, highPotential = 0, trash_cs = 0;
    let approved = 0, inProcess = 0, denied = 0, rts = 0;
    let returnedDOs = 0, rtsFromReturned = 0, approvedFromReturned = 0;
    let verifiedWithin45 = 0, notReturnedWithin45 = 0;
    let leadsOlderThan45 = 0, orderSignedOlderThan45 = 0;

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
      const cc  = String(row[COL.CENTER_CODE]               || 'Unknown');
      const psU = ps.toUpperCase();

      leadStatusDist[ls || 'Unknown']       = (leadStatusDist[ls || 'Unknown']       || 0) + 1;
      chaserStatusDist[cs || 'Unknown']     = (chaserStatusDist[cs || 'Unknown']     || 0) + 1;
      processingStatusDist[ps || 'Unknown'] = (processingStatusDist[ps || 'Unknown'] || 0) + 1;
      centerStats[cc] = (centerStats[cc] || 0) + 1;

      const isVerified = DISPOSITIONS.LEAD_PRODUCTION.includes(ls);
      const isReturned = DISPOSITIONS.CHASER_SIGNED.includes(cs);
      const isRTS      = psU === 'SHIPPED RTS';
      const isApproved = psU === 'APPROVED';

      if (isVerified) verified++; else trash_ls++;

      if (isReturned) {
        orderSigned++; returnedDOs++;
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

      if (isVerified && rowDate && !isNaN(rowDate) && rowDate >= cutoff45) {
        verifiedWithin45++;
        if (!isReturned) notReturnedWithin45++;
      }
      if (rowDate && !isNaN(rowDate) && rowDate < cutoff45) {
        leadsOlderThan45++;
        if (isReturned) orderSignedOlderThan45++;
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
