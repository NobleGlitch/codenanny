import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, expandHome } from '../../packages/cli/src/config.js';

// Helper: create a temp dir with an optional codenanny.config.json
function makeTempDir(configContent) {
  const dir = mkdtempSync(join(tmpdir(), 'cn-config-test-'));
  if (configContent !== undefined) {
    writeFileSync(join(dir, 'codenanny.config.json'), configContent, 'utf8');
  }
  return dir;
}

// 1. Empty cwd (no config file) → returns args unchanged, no errors
test('loadConfig: empty cwd returns args unchanged', () => {
  const dir = makeTempDir(); // no file written
  const args = { _: ['serve'], port: '8080' };
  const result = loadConfig(args, { cwd: dir });
  assert.deepEqual(result, args);
});

// 2. Valid JSON config file → values are merged in
test('loadConfig: valid config file is parsed and merged', () => {
  const dir = makeTempDir(JSON.stringify({ port: 7777, watch: false, db: './test.db' }));
  const args = { _: ['serve'] };
  const result = loadConfig(args, { cwd: dir });
  assert.equal(result.port, 7777);
  assert.equal(result.watch, false);
  assert.equal(result.db, './test.db');
});

// 3. Malformed JSON → loadConfig calls process.exit(2)
test('loadConfig: malformed JSON causes exit 2', () => {
  const dir = makeTempDir('{bad json{{');

  // Temporarily mock process.exit
  const originalExit = process.exit;
  let exitCode;
  process.exit = (code) => { exitCode = code; throw new Error(`exit:${code}`); };

  try {
    loadConfig({ _: [] }, { cwd: dir });
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(exitCode, 2, 'exit code should be 2');
  } finally {
    process.exit = originalExit;
  }
});

// 4. Merge precedence: CLI arg wins over config file value
test('loadConfig: CLI arg overrides config file value', () => {
  const dir = makeTempDir(JSON.stringify({ port: 7777 }));
  const args = { _: ['serve'], port: '9999' }; // explicit CLI override
  const result = loadConfig(args, { cwd: dir });
  assert.equal(result.port, '9999', 'CLI port should win over config file port');
});

// 5. ~/path expansion in config file values
test('loadConfig: ~ in path values is expanded to homedir', () => {
  const dir = makeTempDir(JSON.stringify({ source: '~/.claude/projects' }));
  const args = { _: ['serve'] };
  const result = loadConfig(args, { cwd: dir });
  const expected = join(homedir(), '.claude/projects');
  assert.equal(result.src, expected, '~ should be expanded to homedir');
});

// 6. --no-config skips reading the file entirely
test('loadConfig: --no-config skips file reading', () => {
  const dir = makeTempDir(JSON.stringify({ port: 7777 }));
  const args = { _: ['serve'], 'no-config': true };
  const result = loadConfig(args, { cwd: dir });
  // port should NOT be merged from config file
  assert.equal(result.port, undefined, 'port should be absent when --no-config is used');
  assert.equal(result['no-config'], true);
});

// 7. Empty JSON object {} → treated as no-op, args returned unchanged
test('loadConfig: empty JSON object is a no-op', () => {
  const dir = makeTempDir('{}');
  const args = { _: ['serve'], port: '8080' };
  const result = loadConfig(args, { cwd: dir });
  assert.deepEqual(result, args);
});

// 8. expandHome helper
test('expandHome: expands ~/ correctly', () => {
  assert.equal(expandHome('~/foo/bar'), join(homedir(), 'foo/bar'));
  assert.equal(expandHome('~'), homedir());
  assert.equal(expandHome('/absolute/path'), '/absolute/path');
  assert.equal(expandHome('relative/path'), 'relative/path');
});
