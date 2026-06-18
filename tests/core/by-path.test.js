import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import express from 'express';
import { createApi } from '../../packages/core/src/api.js';
import { createRouter } from '../../packages/core/src/router.js';
import { freshDb } from '../helpers/db.js';

function seed(db, rows) {
  db.exec(`
    INSERT OR REPLACE INTO sessions(id, source_path, started_at, ended_at, project_id, title)
    VALUES ('s1', '/tmp/s1.jsonl', 1, 2, 'proj-a', 'Session One'),
           ('s2', '/tmp/s2.jsonl', 3, 4, 'proj-a', 'Session Two'),
           ('s3', '/tmp/s3.jsonl', 5, 6, 'proj-b', 'Session Three');
  `);
  const ins = db.prepare(
    `INSERT INTO session_files(session_id, path, action, ts, turn_uuid) VALUES (?, ?, ?, ?, ?)`
  );
  for (const r of rows) ins.run(r.session_id, r.path, r.action, r.ts, r.turn_uuid || null);
}

test('byPath: exact match returns only sessions that touched that exact path', () => {
  const db = freshDb();
  seed(db, [
    { session_id: 's1', path: '/abs/foo/bar.js', action: 'write', ts: 100 },
    { session_id: 's1', path: '/abs/foo/baz.js', action: 'edit',  ts: 150 },
    { session_id: 's2', path: '/abs/foo/bar.js', action: 'read',  ts: 200 },
    { session_id: 's3', path: '/abs/other.js',   action: 'write', ts: 300 },
  ]);
  const api = createApi(db);
  const hits = api.sessions.byPath('/abs/foo/bar.js', { mode: 'exact' });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].session_id, 's2', 'most recently touched first');
  assert.equal(hits[0].action_counts.read, 1);
  assert.equal(hits[1].session_id, 's1');
  assert.equal(hits[1].touch_count, 1);
});

test('byPath: prefix match returns sessions that touched anything under a dir', () => {
  const db = freshDb();
  seed(db, [
    { session_id: 's1', path: '/abs/foo/bar.js', action: 'write', ts: 100 },
    { session_id: 's1', path: '/abs/foo/baz.js', action: 'edit',  ts: 150 },
    { session_id: 's2', path: '/abs/foo/sub/x.js', action: 'write', ts: 200 },
    { session_id: 's3', path: '/abs/other/x.js', action: 'write', ts: 300 },
  ]);
  const api = createApi(db);
  const hits = api.sessions.byPath('/abs/foo/', { mode: 'prefix' });
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.session_id), ['s2', 's1']);
  const s1 = hits.find((h) => h.session_id === 's1');
  assert.equal(s1.touch_count, 2);
  assert.deepEqual(s1.action_counts, { write: 1, edit: 1 });
});

test('byPath: auto mode picks prefix when path ends with /', () => {
  const db = freshDb();
  seed(db, [
    { session_id: 's1', path: '/x/a.js', action: 'write', ts: 100 },
    { session_id: 's2', path: '/x/b.js', action: 'write', ts: 200 },
  ]);
  const api = createApi(db);
  assert.equal(api.sessions.byPath('/x/', { mode: 'auto' }).length, 2);
  assert.equal(api.sessions.byPath('/x',  { mode: 'auto' }).length, 0);
  assert.equal(api.sessions.byPath('/x/a.js', { mode: 'auto' }).length, 1);
});

test('byPath: empty/invalid path returns empty array', () => {
  const db = freshDb();
  const api = createApi(db);
  assert.deepEqual(api.sessions.byPath('', {}), []);
  assert.deepEqual(api.sessions.byPath(null, {}), []);
});

test('byPath: SQL wildcards in path are escaped (no false-positive matches)', () => {
  const db = freshDb();
  seed(db, [
    { session_id: 's1', path: '/abs/foo_bar.js', action: 'write', ts: 100 },
    { session_id: 's2', path: '/abs/fooXbar.js', action: 'write', ts: 200 },
  ]);
  const api = createApi(db);
  // Underscore is a single-char wildcard in LIKE; we escape it so the
  // search for `_` only matches a literal underscore.
  const hits = api.sessions.byPath('/abs/foo_', { mode: 'prefix' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].session_id, 's1');
});

function startServer(db) {
  const events = new EventEmitter();
  const api = createApi(db);
  const app = express();
  app.use('/codenanny', createRouter({ api, db, events }));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}/codenanny`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('GET /api/files/by-path?path=... returns matching sessions', async () => {
  const db = freshDb();
  seed(db, [
    { session_id: 's1', path: '/abs/foo/bar.js', action: 'write', ts: 100 },
    { session_id: 's2', path: '/abs/foo/bar.js', action: 'read',  ts: 200 },
    { session_id: 's3', path: '/abs/other.js',   action: 'write', ts: 300 },
  ]);
  const { base, close } = await startServer(db);
  try {
    const r = await fetch(`${base}/api/files/by-path?path=${encodeURIComponent('/abs/foo/bar.js')}`);
    assert.equal(r.status, 200);
    const hits = await r.json();
    assert.equal(hits.length, 2);
    assert.equal(hits[0].session_id, 's2');
  } finally {
    await close();
  }
});

test('GET /api/files/by-path with no path returns 400', async () => {
  const { base, close } = await startServer(freshDb());
  try {
    const r = await fetch(`${base}/api/files/by-path`);
    assert.equal(r.status, 400);
  } finally {
    await close();
  }
});

test('byPath: sample_paths caps at 5 distinct paths per session', () => {
  const db = freshDb();
  const rows = [];
  for (let i = 0; i < 10; i++) {
    rows.push({ session_id: 's1', path: `/abs/foo/file${i}.js`, action: 'write', ts: 100 + i });
  }
  seed(db, rows);
  const api = createApi(db);
  const hits = api.sessions.byPath('/abs/foo/', { mode: 'prefix' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].touch_count, 10);
  assert.equal(hits[0].sample_paths.length, 5);
});
