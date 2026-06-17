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

> **v0.3 simplification:** the wizard now handles step 5 (refresh-token exchange) automatically.
> You only need steps 1–4 below. Once you have a `client_id` and `client_secret`, click
> **"Connect Google Drive"** in wizard step 5 — the browser consent screen opens in a popup,
> and the refresh token is filled in for you when you finish.

To use the `gdrive` adapter you need an OAuth client. Steps (5 minutes, one-time):

1. **Console:** https://console.cloud.google.com → APIs & Services → Library → enable **Google Drive API**.
2. **Credentials → Create Credentials → OAuth client ID** → application type **Web application**.
   - Under **Authorized redirect URIs**, add exactly: `http://localhost:7700/oauth/gdrive/callback`
     (this must match the wizard's callback URL precisely — change the port only if you run the wizard on a different port).
   - Note the `client_id` and `client_secret`.
3. **OAuth consent screen:** add your Google account as a test user.
4. Paste `client_id` and `client_secret` into the **host** and **user** fields in wizard step 5, then click **"Connect Google Drive"**.

**Manual alternative (no wizard):** if you already have a refresh token or prefer the OAuth Playground:
- Visit https://developers.google.com/oauthplayground, click the gear icon → "Use your own OAuth credentials",
  paste your `client_id` and `client_secret`, select scope `https://www.googleapis.com/auth/drive.file`,
  authorize, exchange the code, copy the **refresh_token**, and paste it into the `auth` field directly.

## Security note

Credentials passed to adapters are forwarded to network calls in plaintext. When stored in the codenanny database (via connection profiles), they're encrypted at rest (AES-256-GCM, key from the `CODENANNY_SECRET` env var). Don't commit your refresh_token to git.
