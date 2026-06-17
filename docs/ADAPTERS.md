# Writing a delivery adapter

Adapters are the "where does the export bundle go" part of codenanny. They're tiny — one file, one exported function. Adding a new one (Dropbox, S3, B2, IPFS, your-own-VPS, whatever) doesn't require touching the rest of the codebase.

## The contract

```js
// packages/adapters/src/delivery-myservice.js

export async function deliver(bundle, opts) {
  // bundle: the JSON payload codenanny built for you
  // opts:   { path, host, user, auth }   ← from wizard or CLI

  // ... ship it wherever

  return { location: 'human-readable description of where it went' };
}
```

That's the whole interface.

## The bundle

`bundle` is a plain object:

```js
{
  generated_at: '2026-06-17T04:00:00.000Z',
  stats: { sessions: 142, files: 891, prompts: 12_847, projects: 7 },
  projects: [ { id, name, color, parent_dir }, ... ],
  sessions: [
    {
      id, source_path, started_at, ended_at, project_id, title, summary,
      prompts: [ { ts, role, text }, ... ],
      files:   [ { path, action, content_hash, ts }, ... ],
    },
    ...
  ],
}
```

Adapters should preserve the bundle as-is and produce two artifacts at the destination:

- **`index.json`** — the bundle itself
- **`index.html`** — the static viewer (codenanny provides `viewerHTML` for you; see below)

This way, every export looks identical at the destination regardless of which transport carried it.

## A complete example

```js
// packages/adapters/src/delivery-myservice.js
import { viewerHTML } from './_viewer.js';

export async function deliver(bundle, opts = {}) {
  const { path: targetPath, host, user, auth } = opts;

  if (!host || !user || !auth || !targetPath) {
    throw new Error('myservice: host, user, auth, path all required');
  }

  const html = viewerHTML(bundle.generated_at);
  const json = JSON.stringify(bundle, null, 2);

  // ... your service's upload logic
  await myservice.upload({ host, user, auth, path: targetPath + '/index.html', body: html });
  await myservice.upload({ host, user, auth, path: targetPath + '/index.json', body: json });

  return { location: `myservice://${host}${targetPath}` };
}
```

## Registering the adapter

Add it to `packages/adapters/index.js`:

```js
import { deliver as deliverMyservice } from './src/delivery-myservice.js';

const ADAPTERS = {
  local:     { deliver: deliverLocal },
  scp:       { deliver: deliverScp },
  gdrive:    { deliver: deliverGdrive },
  ftp:       { deliver: deliverFtp },
  myservice: { deliver: deliverMyservice },  // ← new
};
```

That's it. The wizard picks it up via the destination-type dropdown automatically (add the option in `packages/wizard/public/wizard.js` `destination_type` field).

## Credentials

The wizard collects four credential fields on the form:

| Wizard field | Common meaning |
|---|---|
| `host` | server hostname / OAuth client_id / API endpoint |
| `user` | username / OAuth client_secret / api key |
| `auth` | password / private key / refresh token / api secret |
| `path` | destination path / bucket / folder id |

You decide which fields your adapter uses. Document the mapping in the adapter's README so wizard users know what to enter.

## Reading credentials from env

If a credential is missing from `opts`, fall back to env vars with a `CODENANNY_<TYPE>_<FIELD>` naming convention:

```js
const host = opts.host || process.env.CODENANNY_MYSERVICE_HOST;
const user = opts.user || process.env.CODENANNY_MYSERVICE_USER;
const auth = opts.auth || process.env.CODENANNY_MYSERVICE_AUTH;
```

This lets the CLI work without re-prompting if creds are in the environment.

## Errors

Throw an `Error` with a useful message on failure. The wizard surfaces this verbatim to the user. Prefix with the adapter name so users know which adapter complained:

```js
throw new Error(`myservice: upload failed (${response.status}) ${response.statusText}`);
```

## Streaming vs buffering

For most adapters, JSON-stringify the bundle and upload as a single body. If your service has a streaming upload API and you're routinely dealing with bundles >100 MB, switch to streaming. (codenanny doesn't yet stream-encode the bundle — that's on the v0.3 list.)

## Testing your adapter

```bash
node packages/cli/bin/codenanny.js export \
  --dest myservice://host/path \
  --src ~/.claude/projects \
  --db ./test.db
```

You'll need to add the `myservice://` scheme parser to `packages/cli/src/export-cmd.js` if you want CLI URL support — otherwise the wizard form is enough.

## Adapters already in the box

| Name | Status | Notes |
|---|---|---|
| `local` | functional | Writes `index.html` + `index.json` to a directory |
| `scp` | functional | `ssh2-sftp-client`; password or PEM key auto-detected |
| `gdrive` | functional | Refresh-token flow; multipart upload via native fetch |
| `ftp` | functional | `basic-ftp`; plain FTP by default, FTPS via port 990 or `CODENANNY_FTP_SECURE=true`; password auth only |

If you write a Dropbox / S3 / B2 / IPFS / WebDAV / Mega / etc. adapter, open a PR. We're happy to ship more.
