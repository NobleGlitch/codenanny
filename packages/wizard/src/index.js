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

export async function startWizard({ port = 7700, onSubmit } = {}) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(publicDir));

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
