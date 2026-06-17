import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const publicDir = join(__dirname, '../public');

// ---------------------------------------------------------------------------
// GDrive OAuth state map — keyed by random state token.
// Entries older than 10 minutes are swept out on first use.
// ---------------------------------------------------------------------------
const oauthStateMap = new Map();
const OAUTH_TTL_MS = 10 * 60 * 1000;
let oauthSweepStarted = false;

// ---------------------------------------------------------------------------
// Access token cache — keyed by refresh_token, holds { access_token, expires_at }.
// Avoids hitting Google's token endpoint on every folder-list request.
// ---------------------------------------------------------------------------
const accessTokenCache = new Map();

/**
 * Exchange a refresh token for a short-lived access token, using the in-memory
 * cache to avoid redundant network calls. Exposed for testing via the optional
 * `_fetchImpl` parameter.
 *
 * @param {{ client_id: string, client_secret: string, refresh_token: string }} creds
 * @param {typeof fetch} [_fetchImpl]
 * @returns {Promise<string>}
 */
export async function getAccessToken(creds, _fetchImpl = fetch) {
  const cacheKey = creds.refresh_token;
  const cached = accessTokenCache.get(cacheKey);
  // Leave a 60-second buffer before true expiry to avoid edge-case races.
  if (cached && cached.expires_at - 60_000 > Date.now()) {
    return cached.access_token;
  }

  const params = new URLSearchParams({
    client_id:     creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type:    'refresh_token',
  });
  const r = await _fetchImpl('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });
  if (!r.ok) {
    const body = await r.text();
    const err = new Error(`Token refresh failed (${r.status}): ${body}`);
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  const { access_token, expires_in } = data;
  accessTokenCache.set(cacheKey, {
    access_token,
    expires_at: Date.now() + (expires_in ?? 3600) * 1000,
  });
  return access_token;
}

function startOauthSweepIfNeeded() {
  if (oauthSweepStarted) return;
  oauthSweepStarted = true;
  setInterval(() => {
    const cutoff = Date.now() - OAUTH_TTL_MS;
    for (const [key, entry] of oauthStateMap) {
      if (entry.created_at < cutoff) oauthStateMap.delete(key);
    }
  }, 60_000).unref();
}

export async function startWizard({ port = 7700, onSubmit, _fetch, _getAccessToken } = {}) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(publicDir));

  // Allow tests to inject a mock fetch and/or a mock getAccessToken.
  app.locals._fetch          = _fetch          || null;
  app.locals._getAccessToken = _getAccessToken || getAccessToken;

  // -------------------------------------------------------------------------
  // GET /oauth/gdrive/start?client_id=<id>&client_secret=<secret>
  // Generates a Google OAuth URL + CSRF state token, stashes credentials,
  // and returns { url, state } so the client can open the popup.
  // -------------------------------------------------------------------------
  app.get('/oauth/gdrive/start', (req, res) => {
    const { client_id, client_secret } = req.query;
    if (!client_id || !client_secret) {
      return res.status(400).json({ ok: false, message: 'client_id and client_secret are required' });
    }
    startOauthSweepIfNeeded();
    const state = randomBytes(16).toString('hex');
    oauthStateMap.set(state, { client_id, client_secret, created_at: Date.now() });

    const redirect_uri = `http://localhost:${port}/oauth/gdrive/callback`;
    const params = new URLSearchParams({
      client_id,
      redirect_uri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.file',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.json({ ok: true, url, state });
  });

  // -------------------------------------------------------------------------
  // GET /oauth/gdrive/callback?code=<code>&state=<state>
  // Exchanges the auth code for tokens, then sends the refresh_token back to
  // the opener window via postMessage and renders a self-closing success page.
  // -------------------------------------------------------------------------
  app.get('/oauth/gdrive/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) {
      return res.status(400).send(`<html><body><p>OAuth error: ${String(error)}</p><script>window.close();</script></body></html>`);
    }
    if (!code || !state) {
      return res.status(400).send('<html><body><p>Missing code or state.</p></body></html>');
    }
    const entry = oauthStateMap.get(state);
    if (!entry) {
      return res.status(400).send('<html><body><p>Unknown or expired state token. Please try again.</p></body></html>');
    }
    oauthStateMap.delete(state);

    const redirect_uri = `http://localhost:${port}/oauth/gdrive/callback`;
    let tokenData;
    try {
      const tokenParams = new URLSearchParams({
        code,
        client_id: entry.client_id,
        client_secret: entry.client_secret,
        redirect_uri,
        grant_type: 'authorization_code',
      });
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: tokenParams.toString(),
      });
      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        throw new Error(`Token exchange failed (${tokenRes.status}): ${text}`);
      }
      tokenData = await tokenRes.json();
    } catch (e) {
      return res.status(500).send(`<html><body><p>Token exchange error: ${String(e.message)}</p></body></html>`);
    }

    const { refresh_token, access_token, expires_in } = tokenData;
    // Send the tokens back to the wizard opener window via postMessage, then
    // close the popup. The wizard listens for this message in wizard.js.
    res.send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>codenanny — Google Drive connected</title></head>
<body>
  <p>Google Drive connected! You can close this tab.</p>
  <script>
    try {
      window.opener.postMessage(
        ${JSON.stringify(JSON.stringify({ type: 'codenanny:gdrive:oauth', refresh_token, access_token, expires_in }))},
        window.location.origin
      );
    } catch (e) {}
    window.close();
  </script>
</body>
</html>`);
  });

  // -------------------------------------------------------------------------
  // GET /oauth/gdrive/folders?refresh_token=&client_id=&client_secret=&parent=<id>
  // Lists subfolders of <parent> (default: root).  Returns JSON:
  //   { folders: [{id, name, modifiedTime}], parent: '<parent>' }
  // Access tokens are cached in memory for ~50 min.
  // Accepts an optional _fetch override (last query param, not forwarded) for
  // unit tests; production code never passes it — use the server's _fetchImpl.
  // -------------------------------------------------------------------------
  app.get('/oauth/gdrive/folders', async (req, res) => {
    const { refresh_token, client_id, client_secret, parent = 'root' } = req.query;

    if (!refresh_token || !client_id || !client_secret) {
      return res.status(400).json({
        ok: false,
        message: 'refresh_token, client_id, and client_secret are required',
      });
    }

    let access_token;
    try {
      access_token = await app.locals._getAccessToken(
        { client_id, client_secret, refresh_token },
        app.locals._fetch,
      );
    } catch (e) {
      const status = e.status === 400 ? 401 : 502;
      return res.status(status).json({ ok: false, message: e.message });
    }

    const q =
      `mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;
    const driveUrl =
      'https://www.googleapis.com/drive/v3/files?' +
      new URLSearchParams({
        q,
        fields:  'files(id,name,modifiedTime,parents)',
        pageSize: '200',
        orderBy:  'name',
      }).toString();

    let driveData;
    try {
      const r = await (app.locals._fetch || fetch)(driveUrl, {
        headers: { authorization: `Bearer ${access_token}` },
      });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(`Drive API error (${r.status}): ${body}`);
      }
      driveData = await r.json();
    } catch (e) {
      return res.status(502).json({ ok: false, message: e.message });
    }

    res.json({
      ok:      true,
      folders: (driveData.files || []).map(({ id, name, modifiedTime }) => ({ id, name, modifiedTime })),
      parent,
    });
  });

  // -------------------------------------------------------------------------
  // POST /oauth/gdrive/create-folder
  // Body: { refresh_token, client_id, client_secret, parent, name }
  // Creates a Drive folder and returns { id, name }.
  // -------------------------------------------------------------------------
  app.post('/oauth/gdrive/create-folder', async (req, res) => {
    const { refresh_token, client_id, client_secret, parent = 'root', name } = req.body;

    if (!refresh_token || !client_id || !client_secret) {
      return res.status(400).json({
        ok: false,
        message: 'refresh_token, client_id, and client_secret are required',
      });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ ok: false, message: 'name is required' });
    }

    let access_token;
    try {
      access_token = await app.locals._getAccessToken(
        { client_id, client_secret, refresh_token },
        app.locals._fetch,
      );
    } catch (e) {
      return res.status(502).json({ ok: false, message: e.message });
    }

    const metadata = {
      name:     name.trim(),
      mimeType: 'application/vnd.google-apps.folder',
      parents:  [parent],
    };

    let created;
    try {
      const r = await (app.locals._fetch || fetch)(
        'https://www.googleapis.com/drive/v3/files?fields=id,name',
        {
          method:  'POST',
          headers: {
            authorization:  `Bearer ${access_token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(metadata),
        }
      );
      if (!r.ok) {
        const body = await r.text();
        throw new Error(`Drive API error (${r.status}): ${body}`);
      }
      created = await r.json();
    } catch (e) {
      return res.status(502).json({ ok: false, message: e.message });
    }

    res.json({ ok: true, id: created.id, name: created.name });
  });

  app.post('/api/wizard/submit', async (req, res) => {
    try {
      if (typeof onSubmit === 'function') {
        const result = await onSubmit(req.body, { app });
        return res.json({ ok: true, ...result });
      }
      console.log('[wizard] received config (no runtime handler wired):', JSON.stringify(req.body, null, 2));
      res.json({
        ok: true,
        message: 'Configuration received. No runtime handler is wired — pass `onSubmit` to startWizard() to act on it.',
        received: req.body,
      });
    } catch (e) {
      console.error('[wizard] onSubmit error:', e);
      res.status(500).json({ ok: false, message: e.message, stack: e.stack });
    }
  });

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`[codenanny wizard] open http://localhost:${port}`);
      resolve({ server, port, app });
    });
  });
}
