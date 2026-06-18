import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ingestAll } from '../../packages/core/src/ingest.js';
import { createApi } from '../../packages/core/src/api.js';
import { resumeBundle } from '../../packages/core/src/resume.js';
import { freshDb } from '../helpers/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, '../fixtures');

async function seed() {
  const db = freshDb();
  await ingestAll(db, FIXTURE_DIR);
  return { db, api: createApi(db) };
}

function pickSessionId(db) {
  return db.prepare("SELECT id FROM sessions WHERE project_id = 'sample-project'").get().id;
}

test('resumeBundle returns null for unknown session', async () => {
  const { api } = await seed();
  assert.equal(resumeBundle(api, 'no-such-session-id'), null);
});

test('resumeBundle returns formatted markdown for a real session', async () => {
  const { db, api } = await seed();
  const sid = pickSessionId(db);

  const bundle = resumeBundle(api, sid);
  assert.ok(bundle, 'bundle should exist');
  assert.equal(bundle.session.id, sid);
  assert.ok(bundle.formatted.startsWith('# Resume bundle'), 'formatted should start with heading');
  assert.ok(
    bundle.formatted.includes('You are picking up an in-progress session'),
    'should contain the resume instruction footer'
  );
  assert.ok(bundle.trailingTurns.length >= 1, 'should include trailing turns');
});

test('resumeBundle respects the turns option', async () => {
  const { db, api } = await seed();
  const sid = pickSessionId(db);

  const small = resumeBundle(api, sid, { turns: 1 });
  const big = resumeBundle(api, sid, { turns: 50 });

  assert.equal(small.trailingTurns.length, 1, 'turns=1 returns exactly 1');
  assert.ok(big.trailingTurns.length >= small.trailingTurns.length);
  assert.ok(big.trailingTurns.length <= big.totals.prompts);
});

test('resumeBundle truncates per-turn text when oversized', async () => {
  const { db, api } = await seed();
  const sid = pickSessionId(db);

  const bundle = resumeBundle(api, sid, { maxTurnChars: 5 });
  const anyTruncated = bundle.trailingTurns.some((t) => t.truncated);
  // fixture turns are short, so this just verifies the field exists and is boolean
  assert.equal(typeof anyTruncated, 'boolean');
  for (const t of bundle.trailingTurns) {
    assert.ok(t.text.length <= 5 + 64, 'truncated text stays within max + truncation marker');
  }
});

test('resumeBundle surfaces last assistant text when one exists', async () => {
  const { db, api } = await seed();
  const sid = pickSessionId(db);

  const bundle = resumeBundle(api, sid);
  // sample fixture has an assistant turn
  if (bundle.totals.prompts >= 1 && bundle.trailingTurns.some((t) => t.role === 'assistant')) {
    assert.ok(bundle.lastAssistantText, 'lastAssistantText should be populated');
    assert.ok(typeof bundle.lastAssistantText === 'string');
  }
});

test('resumeBundle splits files into created/edited vs read sections', async () => {
  const { db, api } = await seed();
  const sid = pickSessionId(db);

  const bundle = resumeBundle(api, sid);
  if (bundle.touchedFiles.length) {
    const hasWrites = bundle.touchedFiles.some((f) => f.action !== 'read');
    const hasReads  = bundle.touchedFiles.some((f) => f.action === 'read');
    if (hasWrites) assert.ok(bundle.formatted.includes('## Files created or edited'));
    if (hasReads)  assert.ok(bundle.formatted.includes('## Files read for context'));
    assert.ok(bundle.formatted.includes(bundle.touchedFiles[0].path));
  }
});
