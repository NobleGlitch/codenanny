import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ingestAll } from '../../packages/core/src/ingest.js';
import { createApi } from '../../packages/core/src/api.js';
import { freshDb } from '../helpers/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, '../fixtures');

async function seedDb() {
  const db = freshDb();
  await ingestAll(db, FIXTURE_DIR);
  return db;
}

test('api.stats() returns correct counts after ingest', async () => {
  const db = await seedDb();
  const api = createApi(db);
  const stats = api.stats();

  // fixture has 2 JSONL files: one at root (__root project), one in sample-project
  assert.ok(stats.sessions >= 1,  'at least one session');
  assert.ok(stats.files >= 1,     'at least one file action');
  assert.ok(stats.projects >= 1,  'at least one project');
  assert.ok(stats.prompts >= 1,   'at least one prompt');
  assert.equal(typeof stats.sessions, 'number');
  assert.equal(typeof stats.files,    'number');
});

test('api.sessions.list({}) returns sessions and each has a title', async () => {
  const db = await seedDb();
  const api = createApi(db);
  const sessions = api.sessions.list({});

  assert.ok(sessions.length >= 1, 'should return at least one session');
  for (const s of sessions) {
    assert.ok(typeof s.title === 'string' && s.title.length > 0, `session ${s.id} should have a title`);
  }
});

test('api.sessions.prompts(id) returns 2 user prompts for sample-project session', async () => {
  const db = await seedDb();
  const api = createApi(db);

  const sessionRow = db.prepare("SELECT id FROM sessions WHERE project_id = 'sample-project'").get();
  assert.ok(sessionRow, 'sample-project session must exist');

  const prompts = api.sessions.prompts(sessionRow.id);
  const userPrompts = prompts.filter((p) => p.role === 'user');
  assert.equal(userPrompts.length, 2, 'should have 2 user prompts');
});

test('api.search finds a hit on text from the fixture prompts', async () => {
  const db = await seedDb();
  const api = createApi(db);

  // "helper" appears in the first user prompt of the fixture
  const results = api.search('helper');
  assert.ok(results.length >= 1, 'search("helper") should return at least one hit');
});

test('api.projects.list() returns at least one project', async () => {
  const db = await seedDb();
  const api = createApi(db);

  const projects = api.projects.list();
  assert.ok(projects.length >= 1, 'should have at least one project after ingest');
});
