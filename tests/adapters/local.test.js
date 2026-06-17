import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deliver } from '../../packages/adapters/src/delivery-local.js';

function makeBundle(generated_at = new Date().toISOString()) {
  return {
    generated_at,
    stats: { sessions: 1, files: 1, prompts: 2 },
    sessions: [
      {
        id: 'test-session',
        title: 'Test session',
        project_id: 'test-project',
        prompts: [{ role: 'user', text: 'hello' }],
        files:   [{ action: 'write', path: 'src/foo.js' }],
      },
    ],
  };
}

test('deliver writes index.html and index.json to the output directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cn-test-local-'));
  const bundle = makeBundle();
  await deliver(bundle, { path: dir });

  assert.ok(existsSync(join(dir, 'index.html')), 'index.html should exist');
  assert.ok(existsSync(join(dir, 'index.json')), 'index.json should exist');
});

test('index.json is non-empty and parseable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cn-test-local-'));
  const bundle = makeBundle();
  await deliver(bundle, { path: dir });

  const raw = readFileSync(join(dir, 'index.json'), 'utf8');
  assert.ok(raw.length > 0, 'index.json should not be empty');

  const parsed = JSON.parse(raw);
  assert.equal(parsed.stats.sessions, 1, 'parsed JSON should have correct session count');
});

test('index.html is non-empty and contains the generated_at timestamp', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cn-test-local-'));
  const ts = '2025-01-15T12:00:00.000Z';
  const bundle = makeBundle(ts);
  await deliver(bundle, { path: dir });

  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.ok(html.length > 0, 'index.html should not be empty');
  assert.ok(html.includes(ts), 'index.html should include the generated_at timestamp');
});

test('deliver returns an object with type=local and sessions_written count', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cn-test-local-'));
  const result = await deliver(makeBundle(), { path: dir });

  assert.equal(result.type, 'local');
  assert.equal(result.sessions_written, 1);
  assert.ok(typeof result.location === 'string');
});
