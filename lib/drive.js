// lib/drive.js — Google Drive API wrapper
// Replaces: DriveApp in chatUploadImage()

import { google } from 'googleapis';

function _getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key : (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

/**
 * Upload a base64-encoded image to Google Drive and return a public thumbnail URL.
 * Mirrors GAS chatUploadImage() file handling.
 *
 * @param {string} base64Data  — raw base64 string (no data: prefix)
 * @param {string} mimeType    — e.g. 'image/jpeg'
 * @param {string} filename    — desired file name
 * @returns {Promise<string>}  — public Drive thumbnail URL
 */
export async function uploadImageToDrive(base64Data, mimeType, filename = 'image.jpg') {
  const drive = google.drive({ version: 'v3', auth: _getAuth() });

  // ── Find or create the shared folder ──────────────────────────────────────
  const FOLDER_NAME = 'ICO_Chat_Images';
  const folderSearch = await drive.files.list({
    q     : `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });

  let folderId;
  if (folderSearch.data.files.length > 0) {
    folderId = folderSearch.data.files[0].id;
  } else {
    const folder = await drive.files.create({
      requestBody: { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
      fields     : 'id',
    });
    folderId = folder.data.id;
  }

  // ── Upload the file ────────────────────────────────────────────────────────
  const buffer = Buffer.from(base64Data, 'base64');
  const { Readable } = await import('stream');
  const stream = Readable.from(buffer);

  const file = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media      : { mimeType, body: stream },
    fields     : 'id',
  });

  const fileId = file.data.id;

  // ── Make publicly readable ─────────────────────────────────────────────────
  await drive.permissions.create({
    fileId      : fileId,
    requestBody : { role: 'reader', type: 'anyone' },
  });

  // Return a thumbnail URL (same format as GAS version)
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1400-h1400`;
}
