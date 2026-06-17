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
- `path` — Google Drive folder ID or empty for root.
  **The wizard picks it for you — no manual steps needed.** After completing OAuth
  in the wizard, the folder picker lets you browse and select a Drive folder by
  clicking, then writes the ID into this field automatically.
  Manual paste is still supported for headless or re-config flows: paste the folder
  ID directly from your Drive URL (the segment after `/folders/`), or use the
  "Paste folder ID instead" link inside the wizard picker.
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

See [docs/GDRIVE.md](../../docs/GDRIVE.md) for the full canonical walkthrough:
Cloud Console setup → OAuth in the wizard → folder picker → done.

**Short version (v0.4+):** enable the Drive API, create an OAuth client ID
(Web application, redirect URI `http://localhost:7700/oauth/gdrive/callback`),
paste `client_id` + `client_secret` into the wizard, click **"Connect Google Drive"**,
and then use the built-in folder picker to select your target folder — no manual
folder ID copy-paste required.

**Manual alternative (no wizard):** if you already have a refresh token, paste it
directly into the `auth` field and enter the folder ID in the `path` field.
Or use https://developers.google.com/oauthplayground with scope
`https://www.googleapis.com/auth/drive.file` to generate a refresh token.

## Security note

Credentials passed to adapters are forwarded to network calls in plaintext. When stored in the codenanny database (via connection profiles), they're encrypted at rest (AES-256-GCM, key from the `CODENANNY_SECRET` env var). Don't commit your refresh_token to git.
