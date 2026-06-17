import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseTranscript, findTranscripts, ingestAll } from '../../packages/core/src/ingest.js';
import { freshDb } from '../helpers/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_FILE = join(__dirname, '../fixtures/sample-transcript.jsonl');
const FIXTURE_DIR  = join(__dirname, '../fixtures');

test('parseTranscript extracts at least one prompt and one file action', () => {
  const result = parseTranscript(FIXTURE_FILE);

  assert.ok(result.prompts.length >= 1, 'should have at least one prompt');
  assert.ok(result.files.length >= 1,   'should have at least one file action');
});

test('parseTranscript returns expected shape', () => {
  const result = parseTranscript(FIXTURE_FILE);

  assert.ok(typeof result.id === 'string',        'id should be a string');
  assert.ok(typeof result.title === 'string',     'title should be a string');
  assert.ok(Number.isFinite(result.started_at),   'started_at should be a number');
  assert.ok(Number.isFinite(result.ended_at),     'ended_at should be a number');
});

test('parseTranscript prompt roles are user or assistant', () => {
  const { prompts } = parseTranscript(FIXTURE_FILE);
  for (const p of prompts) {
    assert.ok(
      p.role === 'user' || p.role === 'assistant',
      `unexpected role: ${p.role}`
    );
  }
});

test('parseTranscript file action targets src/foo.js', () => {
  const { files } = parseTranscript(FIXTURE_FILE);
  const found = files.some((f) => f.path === 'src/foo.js');
  assert.ok(found, 'expected a file action targeting src/foo.js');
});

test('findTranscripts discovers JSONL files inside project subdirectory', async () => {
  const transcripts = await findTranscripts(FIXTURE_DIR);
  const found = transcripts.some(
    (t) => t.projectDir === 'sample-project' && t.file.endsWith('session-abc.jsonl')
  );
  assert.ok(found, 'findTranscripts should discover session-abc.jsonl in sample-project/');
});

test('ingestAll is idempotent — running twice yields the same row counts', async () => {
  const db = freshDb();

  await ingestAll(db, FIXTURE_DIR);
  const after1 = {
    sessions: db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c,
    files:    db.prepare('SELECT COUNT(*) AS c FROM session_files').get().c,
    prompts:  db.prepare('SELECT COUNT(*) AS c FROM session_prompts').get().c,
  };

  await ingestAll(db, FIXTURE_DIR);
  const after2 = {
    sessions: db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c,
    files:    db.prepare('SELECT COUNT(*) AS c FROM session_files').get().c,
    prompts:  db.prepare('SELECT COUNT(*) AS c FROM session_prompts').get().c,
  };

  assert.deepEqual(after1, after2, 'row counts must not grow on second ingest');
});

test('after one ingest: sessions=1, files=1, prompts=2 for the sample-project session', async () => {
  const db = freshDb();
  // Only ingest the project subdir so we get exactly one session
  const projectDir = join(FIXTURE_DIR, 'sample-project');
  // ingestAll expects the root dir; session-abc.jsonl lives one level inside
  await ingestAll(db, FIXTURE_DIR);

  // The fixture file has 2 user prompts and 1 Write tool_use.
  // parseTranscript also records the assistant text line as a prompt.
  // We only care about the session from sample-project here.
  const sessions = db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE project_id = 'sample-project'").get().c;
  assert.equal(sessions, 1, 'should have exactly one session for sample-project');

  const sessionRow = db.prepare("SELECT id FROM sessions WHERE project_id = 'sample-project'").get();
  const files   = db.prepare('SELECT COUNT(*) AS c FROM session_files WHERE session_id = ?').get(sessionRow.id).c;
  const prompts = db.prepare('SELECT COUNT(*) AS c FROM session_prompts WHERE session_id = ? AND role = ?').get(sessionRow.id, 'user').c;

  assert.equal(files, 1,   'sample session should have 1 file action');
  assert.equal(prompts, 2, 'sample session should have 2 user prompts');
});
