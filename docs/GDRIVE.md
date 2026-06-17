# Google Drive integration

This document is the single canonical reference for connecting codenanny to Google Drive.
Cross-links from `packages/adapters/README.md`, `packages/wizard/README.md`, and
`docs/INSTALL.md` all point here.

## Overview

codenanny exports a static bundle (HTML + JSON) to a folder in your Google Drive.
Authentication uses OAuth 2.0 with a long-lived refresh token — no SDK, no browser
extensions required. The wizard handles the full flow in a popup.

## One-time Google Cloud Console setup (5 minutes)

1. **Enable the API**
   https://console.cloud.google.com → APIs & Services → Library → search **Google Drive API** → Enable.

2. **Create an OAuth client**
   APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:7700/oauth/gdrive/callback`
     (change the port only if you run the wizard on a non-default port)
   - Save — note your **Client ID** and **Client Secret**.

3. **Add yourself as a test user** (while the app is in "Testing" publishing status)
   APIs & Services → OAuth consent screen → Test users → Add your Google account.

That's the one-time setup. You don't need to publish the app or submit it for
Google review — "Testing" status is sufficient for personal and team use.

## Connecting in the wizard

1. Run `npm run wizard` and open http://localhost:7700.
2. Choose **Export** mode and **Google Drive** as the destination.
3. Enter your **Client ID** in the "host" field and **Client Secret** in the "user" field.
4. Click **"Connect Google Drive"** — Google's consent screen opens in a popup.
5. Sign in, grant access, and close the popup. The wizard fills in the refresh token
   automatically and shows the folder picker.

## Picking a folder (v0.4+)

After OAuth completes, the wizard renders a native folder browser:

- **Click any row** to navigate into that subfolder.
- **Breadcrumb** at the top (`My Drive › Projects › Codenanny`) — click any segment
  to navigate back up.
- **"Use this folder"** — confirms the current directory and writes its Drive ID into
  the config.
- **"Create new folder"** — prompts for a name, creates the folder via the Drive API,
  and navigates into it immediately.
- **"Paste folder ID instead"** — reveals the manual text field if you already know
  the ID (headless / re-config flows).

The picker talks to the Drive REST v3 API directly (no Google JS SDK). Folder lists
are fetched from the wizard's own `/oauth/gdrive/folders` route, which caches access
tokens in memory for ~50 minutes to avoid redundant token exchanges.

## Scopes and troubleshooting

The default scope is `drive.file` (picker sees only folders codenanny created or
opened). Use `drive.readonly` for broader browse access. If the picker shows no
folders, confirm the correct scope was granted. To re-authorize, revoke at
https://myaccount.google.com/permissions and click "Connect Google Drive" again.

**Shared Drives** are not yet supported (v0.4, personal drives only).
Shared Drive support via `corpora=drive` is tracked as a v0.5 follow-up.

## Headless / programmatic use

```js
import { getAdapter } from '@codenanny/adapters';
await getAdapter('gdrive').deliver(bundle, {
  host: 'CLIENT_ID', user: 'CLIENT_SECRET',
  auth: 'REFRESH_TOKEN', path: 'DRIVE_FOLDER_ID',
});
// Or pass all three as auth: '{"client_id":"…","client_secret":"…","refresh_token":"…"}'
```
