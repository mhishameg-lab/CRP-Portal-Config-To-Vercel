// pages/api/rpc.js — Single RPC dispatcher
// Replaces: google.script.run.<functionName>(...args)
// Frontend calls: POST /api/rpc  { fn: 'functionName', args: [...] }
// Token is read from body.args[0] OR Authorization header OR cookie.

import { extractToken, setSessionCookie } from '../../lib/auth.js';

// ── Auth service ──────────────────────────────────────────────────────────────
import {
  login, logout, validateSession,
  getUsers, createUser, updateUserStatus, resetUserPassword, deleteUser,
  getActivityLog,
} from '../../services/auth.js';

// ── Data service ──────────────────────────────────────────────────────────────
import {
  getDashboardStats, getLeads, getLeadDetails,
  addNote, setLeadPaymentStatus, getNotifications, markNotificationRead, markAllNotificationsRead,
  sendAdminNotification, getFilterOptions, getPcpStats, getPcpLeads, getPcpLeadDetails,
  getInsightsData, runChangeDetection, getAuditLog, getAppConfig, getCriteriaList,
} from '../../services/data.js';

// ─── Function registry ────────────────────────────────────────────────────────
// Maps GAS function names → async JS functions.
// Each entry is either a function ref (token is args[0]) or a custom handler.

const REGISTRY = {
  // Auth
  login                  : (args) => login(...args),
  logout                 : (args) => logout(...args),
  validateSession        : (args) => validateSession(...args),
  getUsers               : (args) => getUsers(...args),
  createUser             : (args) => createUser(...args),
  updateUserStatus       : (args) => updateUserStatus(...args),
  resetUserPassword      : (args) => resetUserPassword(...args),
  deleteUser             : (args) => deleteUser(...args),
  getActivityLog         : (args) => getActivityLog(...args),

  // Data
  getDashboardStats      : (args) => getDashboardStats(...args),
  getLeads               : (args) => getLeads(...args),
  getLeadDetails         : (args) => getLeadDetails(...args),
  addNote                : (args) => addNote(...args),
  setLeadPaymentStatus   : (args) => setLeadPaymentStatus(...args),
  getNotifications       : (args) => getNotifications(...args),
  sendAdminNotification  : (args) => sendAdminNotification(...args),
  markNotificationRead   : (args) => markNotificationRead(...args),
  markAllNotificationsRead: (args) => markAllNotificationsRead(...args),
  getFilterOptions       : (args) => getFilterOptions(...args),
  getPcpStats            : (args) => getPcpStats(...args),
  getPcpLeads            : (args) => getPcpLeads(...args),
  getPcpLeadDetails      : (args) => getPcpLeadDetails(...args),
  getInsightsData        : (args) => getInsightsData(...args),
  runChangeDetection     : (args) => runChangeDetection(...args),
  getAuditLog            : (args) => getAuditLog(...args),
  getAppConfig           : (args) => getAppConfig(...args),
  getCriteriaList        : (args) => getCriteriaList(...args),

  // Incentives (stubs — returns empty so app loads without crashing)
  getIncentives          : (args) => Promise.resolve({ success: true, data: [] }),
  getActiveIncentive     : (args) => Promise.resolve({ success: true, data: null }),
  createIncentive        : (args) => Promise.resolve({ success: true }),
  updateIncentiveStatus  : (args) => Promise.resolve({ success: true }),
  deleteIncentive        : (args) => Promise.resolve({ success: true }),
};

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fn, args = [] } = req.body || {};

  if (!fn || typeof fn !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "fn" field.' });
  }

  const handler = REGISTRY[fn];
  if (!handler) {
    return res.status(404).json({ error: `Unknown function: ${fn}` });
  }

  // Inject token into args[0] if not already present.
  // For login() token is not needed; for everything else the frontend passes it.
  // Belt-and-suspenders: also accept token from header/cookie and splice it in.
  let callArgs = [...args];
  if (fn !== 'login') {
    const headerToken = extractToken(req);
    // If args[0] looks like a UUID/JWT already, trust it; otherwise use header/cookie token.
    if (!callArgs[0] && headerToken) {
      callArgs = [headerToken, ...callArgs];
    }
  }

  try {
    const result = await handler(callArgs);

    // Special case: if login succeeded, set httpOnly cookie so browser auto-sends token.
    if (fn === 'login' && result?.success && result.token) {
      setSessionCookie(res, result.token);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error(`RPC error [${fn}]:`, err);
    return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: '10mb',
  },
};
