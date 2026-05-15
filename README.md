# ICO Center Portal — Next.js / Vercel Edition

Google Apps Script → Next.js migration. Google Sheets remains the database; the GAS runtime is replaced by Vercel serverless functions.

---

## Architecture

```
Browser
  └─ /public/gscript-shim.js   ← replaces google.script.run
       ↓ POST /api/rpc
pages/api/rpc.js                ← single dispatcher (mirrors all GAS functions)
  ├─ services/auth.js           ← port of Auth.gs
  └─ services/data.js           ← port of DataService.gs
       ↓
  lib/sheets.js                 ← Google Sheets API v4 (replaces SpreadsheetApp)
  lib/auth.js                   ← JWT sessions (replaces CacheService + PropertiesService)
  lib/cache.js                  ← in-process cache (replaces CacheService for data)
  lib/drive.js                  ← Drive API helper for file uploads
  lib/utils.js                  ← pure helpers (replaces GAS Utilities)

pages/api/cron/change-detection.js  ← Vercel Cron every 10 min (replaces ScriptApp trigger)
```

---

## Setup

### 1. Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → IAM & Admin → Service Accounts.
2. Create a new service account. Download the JSON key.
3. Share **both spreadsheets** with the service account email as **Editor**.
4. Enable **Google Sheets API** and **Google Drive API** in the project.

### 2. Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```bash
cp .env.example .env.local
```

| Variable | Description |
|---|---|
| `SOURCE_SHEET_ID` | ID of the leads source spreadsheet |
| `CRM_SHEET_ID` | ID of the CRM spreadsheet |
| `GOOGLE_CLIENT_EMAIL` | Service account email |
| `GOOGLE_PRIVATE_KEY` | Private key from the JSON file (keep `\n` escapes) |
| `JWT_SECRET` | Long random string for signing JWTs |
| `CRON_SECRET` | Optional secret to protect the cron endpoint |
| `SESSION_TTL_HOURS` | Session lifetime in hours (default: 8) |
| `WEBFORM_URL` | Your existing web form URL |

### 3. Migrate the HTML frontend

1. In GAS, open your deployed web app and view source (or copy from `index.html` / `CSS.html`).
2. Save the combined HTML to `/public/app.html`.
3. Add this as the **very first** `<script>` tag inside `<head>`:
   ```html
   <script src="/gscript-shim.js"></script>
   ```
4. Remove any `<script>` tag that loads `google.script.run` polyfills.
5. That's it — all `google.script.run.functionName(...)` calls are now routed to `/api/rpc`.

### 4. Deploy to Vercel

```bash
npm install
vercel deploy
```

Set the environment variables in the Vercel dashboard under **Settings → Environment Variables**.

The cron job (`vercel.json`) will automatically run change detection every 10 minutes on the Pro plan. On the free Hobby plan, hit `/api/cron/change-detection` manually or via a free external cron service.

---

## Local Development

```bash
npm install
cp .env.example .env.local   # fill in your values
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Key differences from GAS

| GAS | Next.js |
|---|---|
| `google.script.run.fn(args)` | `POST /api/rpc { fn, args }` via shim |
| `CacheService` | `lib/cache.js` (in-process; swap for Vercel KV on cold starts) |
| `PropertiesService` + `CacheService` for sessions | Stateless JWTs (`lib/auth.js`) |
| `SpreadsheetApp` | `lib/sheets.js` via Sheets API v4 |
| `DriveApp` | `lib/drive.js` via Drive API v3 |
| `Utilities.computeDigest` | `crypto` (Node built-in) |
| `ScriptApp` time trigger | Vercel Cron (`vercel.json`) |
| `HtmlService.createTemplateFromFile` | `pages/index.js` serving `/public/app.html` |

---

## Notes on cache

`lib/cache.js` uses `node-cache` which is in-process memory. On Vercel each lambda invocation may be a cold start with no shared memory. For production with many concurrent users, replace the cache with [Vercel KV](https://vercel.com/docs/storage/vercel-kv) (Redis-compatible). The API in `lib/cache.js` is intentionally identical so swapping is a one-file change.
