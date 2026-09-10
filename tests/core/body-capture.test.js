import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import express from 'express';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractBody,
  parseTranscript,
  indexSession,
} from '../../packages/core/src/ingest.js';
import { createApi } from '../../packages/core/src/api.js';
import { createRouter } from '../../packages/core/src/router.js';
import { freshDb } from '../helpers/db.js';

test('extractBody: Write captures input.content', () => {
  const { body, body_truncated } = extractBody('Write', { content: 'hello world' });
  assert.equal(body, 'hello world');
  assert.equal(body_truncated, 0);
});

test('extractBody: Write falls back to new_string when content absent', () => {
  const { body } = extractBody('Write', { new_string: 'fallback body' });
  assert.equal(body, 'fallback body');
});

test('extractBody: Edit captures input.new_string (the after-state)', () => {
  const { body, body_truncated } = extractBody('Edit', {
    old_string: 'foo',
    new_string: 'bar',
  });
  assert.equal(body, 'bar');
  assert.equal(body_truncated, 0);
});

test('extractBody: MultiEdit concatenates all new_string values with boundary markers', () => {
  const { body, body_truncated } = extractBody('MultiEdit', {
    edits: [
      { old_string: 'a', new_string: 'AA' },
      { old_string: 'b', new_string: 'BB' },
      { old_string: 'c', new_string: 'CC' },
    ],
  });
  assert.equal(body, 'AA\n---\n[multiedit boundary]\n---\nBB\n---\n[multiedit boundary]\n---\nCC');
  assert.equal(body_truncated, 0);
});

test('extractBody: NotebookEdit captures input.new_source', () => {
  const { body } = extractBody('NotebookEdit', { new_source: 'print(42)' });
  assert.equal(body, 'print(42)');
});

test('extractBody: NotebookEdit returns null body when new_source absent', () => {
  const { body, body_truncated } = extractBody('NotebookEdit', {});
  assert.equal(body, null);
  assert.equal(body_truncated, 0);
});

test('extractBody: Read tool returns null body (we do not store read contents)', () => {
  const { body, body_truncated } = extractBody('Read', { file_path: '/tmp/x' });
  assert.equal(body, null);
  assert.equal(body_truncated, 0);
});

test('extractBody: Bash tool returns null body (commands are not file contents)', () => {
  const { body, body_truncated } = extractBody('Bash', { command: 'ls -la' });
  assert.equal(body, null);
  assert.equal(body_truncated, 0);
});

test('extractBody: 64KB cap truncates oversized bodies and sets body_truncated=1', () => {
  const big = 'x'.repeat(70_000);
  const { body, body_truncated } = extractBody('Write', { content: big });
  assert.equal(body.length, 65536, 'truncated body must be exactly 65536 chars');
  assert.equal(body_truncated, 1);
});

test('extractBody: body of exactly 65536 chars is NOT marked truncated', () => {
  const exactly = 'y'.repeat(65536);
  const { body, body_truncated } = extractBody('Write', { content: exactly });
  assert.equal(body.length, 65536);
  assert.equal(body_truncated, 0);
});

test('parseTranscript + indexSession: Write/Edit bodies persisted in session_files.body', () => {
  // Use the existing rich fixture: Write server.js="console.log('hi')"
  // and Edit new_string="console.log('hello')"
  const fixture = new URL('../fixtures/rich-transcript.jsonl', import.meta.url).pathname;
  const parsed = parseTranscript(fixture);

  const writeFile = parsed.files.find((f) => f.action === 'write' && f.path === '/tmp/srv/server.js');
  const editFile = parsed.files.find((f) => f.action === 'edit' && f.path === '/tmp/srv/server.js');
  assert.ok(writeFile, 'write entry exists');
  assert.ok(editFile, 'edit entry exists');
  assert.equal(writeFile.body, "console.log('hi')");
  assert.equal(writeFile.body_truncated, 0);
  assert.equal(editFile.body, "console.log('hello')");

  const readFile = parsed.files.find((f) => f.action === 'read');
  assert.ok(readFile, 'read entry exists');
  assert.equal(readFile.body, null, 'Read tool must not capture a body');

  const bashFile = parsed.files.find((f) => f.action && f.action.startsWith('bash-'));
  assert.ok(bashFile, 'bash entry exists');
  assert.equal(bashFile.body, null, 'Bash must not capture a body');

  const db = freshDb();
  indexSession(db, 'rich-proj', parsed);
  const row = db.prepare(
    `SELECT body, body_truncated FROM session_files WHERE session_id = ? AND action = 'write' AND path = ?`
  ).get(parsed.id, '/tmp/srv/server.js');
  assert.equal(row.body, "console.log('hi')");
  assert.equal(row.body_truncated, 0);
});

test('indexSession: oversized Write body persists truncated body and flag=1', () => {
  // Build a synthetic transcript with a single oversized Write tool_use
  const dir = mkdtempSync(join(tmpdir(), 'cn-body-'));
  const big = 'z'.repeat(70_000);
  const ev = {
    type: 'assistant',
    uuid: 'a1',
    timestamp: 1700000000000,
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/tmp/big.txt', content: big } },
      ],
    },
  };
  const file = join(dir, 'big-session.jsonl');
  writeFileSync(file, JSON.stringify(ev) + '\n');
  const parsed = parseTranscript(file);
  const db = freshDb();
  indexSession(db, 'big-proj', parsed);
  const row = db.prepare(`SELECT body, body_truncated FROM session_files WHERE session_id = ?`).get(parsed.id);
  assert.equal(row.body.length, 65536);
  assert.equal(row.body_truncated, 1);
});

// ---------------------------------------------------------------- route ---
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

function seedOneFile(db) {
  db.exec(`
    INSERT OR REPLACE INTO sessions(id, source_path, started_at, ended_at, project_id, title)
    VALUES ('s1', '/tmp/s1.jsonl', 1, 2, 'proj-a', 'Session One');
  `);
  const ins = db.prepare(
    `INSERT INTO session_files(session_id, path, action, content_hash, ts, turn_uuid, body, body_truncated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const info = ins.run('s1', '/tmp/foo.js', 'write', 'abc123', 100, 'u1', 'console.log(1)', 0);
  return info.lastInsertRowid;
}

test('GET /api/files/:id/body returns 200 with body JSON for a known file', async () => {
  const db = freshDb();
  const id = seedOneFile(db);
  const { base, close } = await startServer(db);
  try {
    const r = await fetch(`${base}/api/files/${id}/body`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.id, Number(id));
    assert.equal(j.session_id, 's1');
    assert.equal(j.session_title, 'Session One');
    assert.equal(j.project_id, 'proj-a');
    assert.equal(j.path, '/tmp/foo.js');
    assert.equal(j.action, 'write');
    assert.equal(j.body, 'console.log(1)');
    assert.equal(j.body_truncated, false);
    assert.equal(j.has_body, true);
  } finally {
    await close();
  }
});

test('GET /api/files/:id/body returns 404 for non-existent id', async () => {
  const db = freshDb();
  const { base, close } = await startServer(db);
  try {
    const r = await fetch(`${base}/api/files/99999/body`);
    assert.equal(r.status, 404);
    const j = await r.json();
    assert.equal(j.error, 'file not found');
  } finally {
    await close();
  }
});

test('GET /api/files/:id/body returns 400 for non-integer id', async () => {
  const db = freshDb();
  const { base, close } = await startServer(db);
  try {
    const r = await fetch(`${base}/api/files/not-a-number/body`);
    assert.equal(r.status, 400);
    const j = await r.json();
    assert.equal(j.error, 'id must be an integer');
  } finally {
    await close();
  }
});
