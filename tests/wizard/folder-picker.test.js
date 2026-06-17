/**
 * tests/wizard/folder-picker.test.js
 *
 * Unit tests for the GDrive folder-picker routes:
 *   GET  /oauth/gdrive/folders
 *   POST /oauth/gdrive/create-folder
 *
 * All Google API calls are mocked — no real network traffic.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startWizard } from '../../packages/wizard/src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal fake token exchange response. */
const FAKE_ACCESS_TOKEN = 'ya29.fake-access-token';
const TOKEN_RESPONSE = { access_token: FAKE_ACCESS_TOKEN, expires_in: 3600 };

/** Factory for a mock fetch that records calls and returns preset responses. */
function makeMockFetch(responses = []) {
  let callIdx = 0;
  const calls = [];

  async function mockFetch(url, opts = {}) {
    calls.push({ url, opts });
    const preset = responses[callIdx++] ?? { status: 200, body: {} };
    return {
      ok:   preset.status >= 200 && preset.status < 300,
      status: preset.status,
      text:   async () => JSON.stringify(preset.body),
      json:   async () => preset.body,
    };
  }

  mockFetch.calls = calls;
  return mockFetch;
}

/** GET convenience wrapper. */
async function get(url) {
  const r = await fetch(url);
  return { status: r.status, body: await r.json() };
}

/** POST convenience wrapper. */
async function post(url, body) {
  const r = await fetch(url, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let server;
let port;
let mockFetch;
let mockGetAccessToken;

before(async () => {
  // We use a high ephemeral port to avoid conflicts.
  port = 17742;

  // Default mock fetch: first call = token exchange success,
  // subsequent calls = Drive API success with one folder.
  mockFetch = makeMockFetch([
    { status: 200, body: TOKEN_RESPONSE },
    {
      status: 200,
      body: {
        files: [
          { id: 'folder-abc', name: 'Projects', modifiedTime: '2026-01-01T00:00:00Z', parents: ['root'] },
        ],
      },
    },
  ]);

  // Provide a simple in-memory getAccessToken that just calls mockFetch.
  mockGetAccessToken = async (creds, _fetchImpl) => {
    const f = _fetchImpl || mockFetch;
    const params = new URLSearchParams({
      client_id:     creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type:    'refresh_token',
    });
    const r = await f('https://oauth2.googleapis.com/token', {
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
    return data.access_token;
  };

  ({ server } = await startWizard({
    port,
    _fetch:           mockFetch,
    _getAccessToken:  mockGetAccessToken,
  }));
});

after(() => {
  server?.close();
});

// ---------------------------------------------------------------------------
// Test 1 — missing refresh_token → 400
// ---------------------------------------------------------------------------
test('/oauth/gdrive/folders — missing refresh_token returns 400', async () => {
  const { status, body } = await get(
    `http://localhost:${port}/oauth/gdrive/folders?client_id=foo&client_secret=bar`
  );
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.ok(body.message.includes('refresh_token'), 'message should mention refresh_token');
});

// ---------------------------------------------------------------------------
// Test 2 — bad client_id/secret → Google returns invalid_client → we 401
// ---------------------------------------------------------------------------
test('/oauth/gdrive/folders — bad credentials bubble up as 401', async () => {
  // Wire a fresh server with a mock that returns 400 (Google's invalid_client).
  const badFetch = makeMockFetch([
    { status: 400, body: { error: 'invalid_client', error_description: 'The OAuth client was not found.' } },
  ]);

  const badGetAccessToken = async (creds, _fetchImpl) => {
    const f = _fetchImpl || badFetch;
    const params = new URLSearchParams({
      client_id:     creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type:    'refresh_token',
    });
    const r = await f('https://oauth2.googleapis.com/token', {
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
    return data.access_token;
  };

  const p2 = 17743;
  const { server: s2 } = await startWizard({
    port:             p2,
    _fetch:           badFetch,
    _getAccessToken:  badGetAccessToken,
  });

  try {
    const { status, body } = await get(
      `http://localhost:${p2}/oauth/gdrive/folders?refresh_token=bad&client_id=bad&client_secret=bad`
    );
    assert.equal(status, 401);
    assert.equal(body.ok, false);
  } finally {
    s2.close();
  }
});

// ---------------------------------------------------------------------------
// Test 3 — Drive API URL is built with the correct mimeType q filter
// ---------------------------------------------------------------------------
test('/oauth/gdrive/folders — Drive query contains correct mimeType filter', async () => {
  // A fresh server so we control exactly which fetch calls happen.
  const captureFetch = makeMockFetch([
    { status: 200, body: TOKEN_RESPONSE },
    { status: 200, body: { files: [] } },
  ]);

  const captureGetAccessToken = async (creds, _fetchImpl) => {
    const f = _fetchImpl || captureFetch;
    const params = new URLSearchParams({
      client_id:     creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type:    'refresh_token',
    });
    const r = await f('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    });
    const data = await r.json();
    return data.access_token;
  };

  const p3 = 17744;
  const { server: s3 } = await startWizard({
    port:             p3,
    _fetch:           captureFetch,
    _getAccessToken:  captureGetAccessToken,
  });

  try {
    await get(
      `http://localhost:${p3}/oauth/gdrive/folders?refresh_token=rt&client_id=ci&client_secret=cs&parent=root`
    );

    // Second call should be to the Drive files API.
    assert.ok(captureFetch.calls.length >= 2, 'should have made at least 2 fetch calls');
    const driveCall = captureFetch.calls[1];
    assert.ok(
      driveCall.url.includes('www.googleapis.com/drive/v3/files'),
      'second call should be to Drive v3 files endpoint'
    );
    const driveUrl = new URL(driveCall.url);
    const q = driveUrl.searchParams.get('q') ?? '';
    assert.ok(
      q.includes("mimeType='application/vnd.google-apps.folder'"),
      `q param should filter by folder mimeType; got: ${q}`
    );
    assert.ok(q.includes('trashed=false'), `q param should exclude trashed; got: ${q}`);
  } finally {
    s3.close();
  }
});

// ---------------------------------------------------------------------------
// Test 4 — Access token cache TTL: second request reuses cached token
// ---------------------------------------------------------------------------
test('/oauth/gdrive/folders — access token is cached between calls', async () => {
  // Track how many token exchanges happen.
  let tokenExchangeCount = 0;

  const cachingFetch = async (url, opts = {}) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenExchangeCount++;
      return {
        ok:     true,
        status: 200,
        text:   async () => JSON.stringify(TOKEN_RESPONSE),
        json:   async () => TOKEN_RESPONSE,
      };
    }
    // Drive list response.
    return {
      ok:     true,
      status: 200,
      text:   async () => JSON.stringify({ files: [] }),
      json:   async () => ({ files: [] }),
    };
  };

  // Use the real getAccessToken (imported from the module) so cache logic runs.
  const { getAccessToken } = await import('../../packages/wizard/src/index.js');

  const p4 = 17745;
  const { server: s4 } = await startWizard({
    port:            p4,
    _fetch:          cachingFetch,
    _getAccessToken: getAccessToken,
  });

  const qs = 'refresh_token=cached-rt&client_id=ci&client_secret=cs';

  try {
    await get(`http://localhost:${p4}/oauth/gdrive/folders?${qs}`);
    await get(`http://localhost:${p4}/oauth/gdrive/folders?${qs}`);

    assert.equal(
      tokenExchangeCount,
      1,
      `token exchange should happen once (cached on second call); got ${tokenExchangeCount}`
    );
  } finally {
    s4.close();
  }
});
