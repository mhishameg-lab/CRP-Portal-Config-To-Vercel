// lib/sheets.js — Google Sheets API v4 wrapper
// Replaces: SpreadsheetApp.openById(), getSheetByName(), getDataRange().getValues(),
//           appendRow(), getRange().setValue(), deleteRow(), sheet.getLastRow()
//
// Uses a service account (GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY env vars).
// Share both spreadsheets with the service account email as an Editor.

import { google } from 'googleapis';
import { SHEET_HEADERS } from './config.js';

// ─── Auth client (singleton) ──────────────────────────────────────────────────

let _authClient = null;

function _getAuth() {
  if (_authClient) return _authClient;
  _authClient = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key : (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    },
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  return _authClient;
}

function _sheetsClient() {
  return google.sheets({ version: 'v4', auth: _getAuth() });
}

// ─── A1 notation helpers ──────────────────────────────────────────────────────

/** Convert 0-based col index → letter (0→A, 25→Z, 26→AA …) */
function colLetter(idx) {
  let s = '';
  let i = idx;
  do {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return s;
}

/** Build A1 range string, e.g. (sheetName, 2, 1, 10, 5) → "SheetName!A2:E11" */
function a1(sheetName, startRow, startCol, numRows, numCols) {
  const r1 = startRow;
  const c1 = colLetter(startCol - 1);
  const r2 = startRow + numRows - 1;
  const c2 = colLetter(startCol + numCols - 2);
  return `'${sheetName}'!${c1}${r1}:${c2}${r2}`;
}

/** Entire sheet (all rows, all cols) */
function a1All(sheetName) { return `'${sheetName}'`; }

// ─── Spreadsheet class ────────────────────────────────────────────────────────

class Spreadsheet {
  constructor(id) {
    this.id = id;
    this._api = _sheetsClient();
  }

  /**
   * Get ALL values in a named sheet as a 2-D array.
   * Row 0 is the header row. Returns [] if the sheet is empty.
   */
  async getValues(sheetName) {
    const res = await this._api.spreadsheets.values.get({
      spreadsheetId: this.id,
      range        : a1All(sheetName),
    });
    return res.data.values || [];
  }

  /**
   * Get values in a specific range.
   * startRow / startCol are 1-based (GAS convention).
   */
  async getRangeValues(sheetName, startRow, startCol, numRows, numCols) {
    if (numRows <= 0) return [];
    const res = await this._api.spreadsheets.values.get({
      spreadsheetId: this.id,
      range        : a1(sheetName, startRow, startCol, numRows, numCols),
    });
    return res.data.values || [];
  }

  /**
   * Append a single row to the bottom of a sheet.
   * Values are plain JS values (strings, numbers, booleans, Dates).
   */
  async appendRow(sheetName, values) {
    const serialized = values.map(v =>
      v instanceof Date ? v.toISOString() :
      v === null || v === undefined ? '' : v
    );
    await this._api.spreadsheets.values.append({
      spreadsheetId           : this.id,
      range                   : `'${sheetName}'!A1`,
      valueInputOption        : 'USER_ENTERED',
      insertDataOption        : 'INSERT_ROWS',
      requestBody             : { values: [serialized] },
    });
  }

  /**
   * Update a single cell.
   * row / col are 1-based (GAS convention).
   */
  async setCell(sheetName, row, col, value) {
    const val = value instanceof Date ? value.toISOString() :
                value === null || value === undefined ? '' : value;
    await this._api.spreadsheets.values.update({
      spreadsheetId   : this.id,
      range           : `'${sheetName}'!${colLetter(col - 1)}${row}`,
      valueInputOption: 'USER_ENTERED',
      requestBody     : { values: [[val]] },
    });
  }

  /**
   * Update a contiguous range (2-D array, same size as range).
   * startRow / startCol are 1-based.
   */
  async setRange(sheetName, startRow, startCol, values2D) {
    if (!values2D || !values2D.length) return;
    const numRows = values2D.length;
    const numCols = values2D[0].length;
    const range   = a1(sheetName, startRow, startCol, numRows, numCols);
    const serialized = values2D.map(row =>
      row.map(v => v instanceof Date ? v.toISOString() :
                   v === null || v === undefined ? '' : v)
    );
    await this._api.spreadsheets.values.update({
      spreadsheetId   : this.id,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody     : { values: serialized },
    });
  }

  /**
   * Delete a row by 1-based row index.
   * Uses batchUpdate with a deleteDimension request.
   */
  async deleteRow(sheetName, rowIndex) {
    // Need the internal sheet ID (not the name)
    const sheetId = await this._getSheetId(sheetName);
    await this._api.spreadsheets.batchUpdate({
      spreadsheetId: this.id,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId   : sheetId,
              dimension : 'ROWS',
              startIndex: rowIndex - 1,  // 0-based
              endIndex  : rowIndex,      // exclusive
            },
          },
        }],
      },
    });
  }

  /**
   * Get the number of rows currently in a sheet (including header).
   * Returns 1 if the sheet only has a header (or is empty).
   */
  async getLastRow(sheetName) {
    const vals = await this.getValues(sheetName);
    return vals.length || 1;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /** Fetch the internal numeric sheet ID needed for batchUpdate */
  async _getSheetId(sheetName) {
    const res = await this._api.spreadsheets.get({
      spreadsheetId: this.id,
      fields       : 'sheets.properties',
    });
    const found = (res.data.sheets || []).find(
      s => s.properties.title === sheetName
    );
    if (!found) throw new Error(`Sheet "${sheetName}" not found in spreadsheet ${this.id}`);
    return found.properties.sheetId;
  }

  /**
   * Ensure a sheet exists; create it with headers if missing.
   * Called automatically by getCrmSheet() below.
   */
  async ensureSheet(sheetName) {
    const res = await this._api.spreadsheets.get({
      spreadsheetId: this.id,
      fields       : 'sheets.properties.title',
    });
    const exists = (res.data.sheets || []).some(s => s.properties.title === sheetName);
    if (exists) return;

    // Create the sheet
    await this._api.spreadsheets.batchUpdate({
      spreadsheetId: this.id,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });

    // Add header row if defined
    const headers = SHEET_HEADERS[sheetName];
    if (headers && headers.length) {
      await this.appendRow(sheetName, headers);
    }
  }
}

// ─── Module-level singletons ──────────────────────────────────────────────────

let _sourceSheet = null;
let _crmSheet    = null;

export function getSourceSpreadsheet() {
  if (!_sourceSheet) _sourceSheet = new Spreadsheet(process.env.SOURCE_SHEET_ID);
  return _sourceSheet;
}

export function getCrmSpreadsheet() {
  if (!_crmSheet) _crmSheet = new Spreadsheet(process.env.CRM_SHEET_ID);
  return _crmSheet;
}

/**
 * Get a sheet from the CRM spreadsheet, auto-creating it with headers if absent.
 * Drop-in replacement for GAS getCrmSheet().
 */
export async function getCrmSheet(sheetName) {
  const ss = getCrmSpreadsheet();
  await ss.ensureSheet(sheetName);
  // Return a thin proxy with the sheet name bound in for convenience
  return new SheetProxy(ss, sheetName);
}

/**
 * Convenience proxy — mirrors the GAS Sheet object's most-used methods
 * so ported service code barely needs to change.
 */
class SheetProxy {
  constructor(ss, name) {
    this._ss   = ss;
    this._name = name;
  }

  getValues()                              { return this._ss.getValues(this._name); }
  getRangeValues(r, c, rows, cols)         { return this._ss.getRangeValues(this._name, r, c, rows, cols); }
  appendRow(values)                        { return this._ss.appendRow(this._name, values); }
  setCell(row, col, value)                 { return this._ss.setCell(this._name, row, col, value); }
  setRange(startRow, startCol, values2D)   { return this._ss.setRange(this._name, startRow, startCol, values2D); }
  deleteRow(rowIndex)                      { return this._ss.deleteRow(this._name, rowIndex); }
  getLastRow()                             { return this._ss.getLastRow(this._name); }
  ensureSheet()                            { return this._ss.ensureSheet(this._name); }
}
