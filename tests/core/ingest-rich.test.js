import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseTranscript, indexSession } from '../../packages/core/src/ingest.js';
import { freshDb } from '../helpers/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RICH = join(__dirname, '../fixtures/rich-transcript.jsonl');

test('parseTranscript captures Read tool_use as action=read', () => {
  const { files } = parseTranscript(RICH);
  const reads = files.filter((f) => f.action === 'read');
  assert.equal(reads.length, 1);
  assert.equal(reads[0].path, '/etc/hosts');
});

test('parseTranscript captures Bash mkdir/touch/cat-redirect/mv', () => {
  const { files } = parseTranscript(RICH);
  const byAction = files.reduce((acc, f) => {
    (acc[f.action] ||= []).push(f.path);
    return acc;
  }, {});
  assert.ok(byAction['bash-mkdir']?.includes('/tmp/srv'), 'mkdir captured');
  assert.ok(byAction['bash-touch']?.includes('/tmp/srv/.gitkeep'), 'touch captured');
  assert.ok(byAction['bash-write']?.includes('/tmp/srv/README.md'), 'cat-redirect captured');
  assert.ok(byAction['bash-move']?.includes('/tmp/srv/docs/README.md'), 'mv destination captured');
});

test('parseTranscript captures Write + Edit alongside Bash/Read', () => {
  const { files } = parseTranscript(RICH);
  assert.ok(files.some((f) => f.action === 'write' && f.path === '/tmp/srv/server.js'));
  assert.ok(files.some((f) => f.action === 'edit' && f.path === '/tmp/srv/server.js'));
});

test('parseTranscript tags every file with the assistant turn uuid', () => {
  const { files } = parseTranscript(RICH);
  const turnA1 = files.filter((f) => f.turn_uuid === 'a1');
  const turnA2 = files.filter((f) => f.turn_uuid === 'a2');
  assert.ok(turnA1.length >= 4, `expected ≥4 files in turn a1, got ${turnA1.length}`);
  assert.ok(turnA2.length >= 2, `expected ≥2 files in turn a2, got ${turnA2.length}`);
  for (const f of files) assert.ok(f.turn_uuid, 'every file should have a turn_uuid');
});

test('indexSession persists turn_uuid + reads', () => {
  const db = freshDb();
  const parsed = parseTranscript(RICH);
  indexSession(db, 'rich-proj', parsed);

  const rows = db.prepare(`SELECT action, path, turn_uuid FROM session_files WHERE session_id = ?`)
    .all(parsed.id);
  assert.ok(rows.length >= 6);
  for (const row of rows) assert.ok(row.turn_uuid, `row missing turn_uuid: ${JSON.stringify(row)}`);

  const reads = rows.filter((r) => r.action === 'read');
  assert.equal(reads.length, 1);
  assert.equal(reads[0].path, '/etc/hosts');
});
