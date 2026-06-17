# @codenanny/adapters

Delivery adapters for codenanny static exports.

| Adapter | Status | Underlying |
|---|---|---|
| `local`  | Functional | filesystem |
| `scp`    | Functional | `ssh2-sftp-client` |
| `gdrive` | Functional (credential-based) | Google Drive REST v3 (no SDK; uses `fetch`) |
| `ftp`    | Functional | `basic-ftp` (plain FTP + FTPS; password auth only, key auth deferred) |

```js
import { getAdapter } from '@codenanny/adapters';
const adapter = getAdapter('local');
await adapter.deliver(bundle, { path: '/somewhere' });
```

## Adapter interface

```ts
deliver(bundle, options) -> Promise<{ type, location, sessions_written, ... }>
```

## Per-adapter options

### `local`
- `path` — destination directory (will be created if missing)

### `scp`
- `path` — `scp://user@host[:port]/path` OR `/path` plus separate `host`, `user`, `port`
- `auth` — password OR PEM private key string

### `gdrive`
- `path` — Google Drive folder ID (from the folder's URL) or empty for root
- Credentials, either:
  - `auth` = JSON string `{"client_id":"...","client_secret":"...","refresh_token":"..."}`
  - or `host`=client_id, `user`=client_secret, `auth`=refresh_token

### `ftp`
- `host` — hostname or `host:port` (env: `CODENANNY_FTP_HOST`)
- `user` — FTP username (env: `CODENANNY_FTP_USER`)
- `auth` — FTP password (env: `CODENANNY_FTP_AUTH`)
- `path` — remote directory (created automatically via `ensureDir`)
- **TLS:** port 990 → implicit FTPS; `CODENANNY_FTP_SECURE=true` → explicit FTPS; otherwise plain FTP on port 21.
- Key-based auth is not yet supported (password only).

## Google Drive one-time setup

To use the `gdrive` adapter you need an OAuth client and a refresh token. Steps (5 minutes, one-time):

1. **Console:** https://console.cloud.google.com → APIs & Services → Library → enable **Google Drive API**.
2. **Credentials → Create Credentials → OAuth client ID** → application type "Desktop". Note the `client_id` and `client_secret`.
3. **OAuth consent screen:** add your Google account as a test user.
4. **Get a refresh token** via the OAuth Playground (https://developers.google.com/oauthplayground):
   - Click the gear icon → check "Use your own OAuth credentials" → paste your `client_id` and `client_secret`
   - In the scopes list, paste: `https://www.googleapis.com/auth/drive.file` → Authorize APIs → grant access
   - Click "Exchange authorization code for tokens" → copy the **refresh_token**.
5. Plug `client_id`, `client_secret`, `refresh_token` into the wizard (or pass them to the CLI/adapter).

(v0.2 will replace this with a one-click OAuth flow hosted by the wizard itself.)

## Security note

Credentials passed to adapters are forwarded to network calls in plaintext. When stored in the codenanny database (via connection profiles), they're encrypted at rest (AES-256-GCM, key from the `CODENANNY_SECRET` env var). Don't commit your refresh_token to git.
