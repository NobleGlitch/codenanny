import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBashFiles } from '../../packages/core/src/bash-files.js';

test('extractBashFiles: redirect > captures write', () => {
  const r = extractBashFiles('echo hi > /tmp/out.txt');
  assert.deepEqual(r, [{ path: '/tmp/out.txt', action: 'bash-write' }]);
});

test('extractBashFiles: redirect >> captures append', () => {
  const r = extractBashFiles('echo hi >> /tmp/log');
  assert.deepEqual(r, [{ path: '/tmp/log', action: 'bash-append' }]);
});

test('extractBashFiles: heredoc cat > FILE captures write', () => {
  const r = extractBashFiles("cat > foo.md <<EOF\nhello\nEOF");
  assert.ok(r.some((x) => x.path === 'foo.md' && x.action === 'bash-write'));
});

test('extractBashFiles: tee captures write', () => {
  assert.deepEqual(extractBashFiles('echo hi | tee /tmp/x'), [
    { path: '/tmp/x', action: 'bash-write' },
  ]);
});

test('extractBashFiles: tee -a captures append', () => {
  assert.deepEqual(extractBashFiles('echo hi | tee -a /tmp/x'), [
    { path: '/tmp/x', action: 'bash-append' },
  ]);
});

test('extractBashFiles: mkdir -p captures multiple dirs', () => {
  const r = extractBashFiles('mkdir -p a/b c/d');
  assert.deepEqual(
    r.map((x) => x.path).sort(),
    ['a/b', 'c/d']
  );
  for (const x of r) assert.equal(x.action, 'bash-mkdir');
});

test('extractBashFiles: touch captures file', () => {
  assert.deepEqual(extractBashFiles('touch /tmp/marker'), [
    { path: '/tmp/marker', action: 'bash-touch' },
  ]);
});

test('extractBashFiles: cp/mv captures destination only', () => {
  const cp = extractBashFiles('cp src.js dst.js');
  assert.deepEqual(cp, [{ path: 'dst.js', action: 'bash-copy' }]);
  const mv = extractBashFiles('mv old.js new.js');
  assert.deepEqual(mv, [{ path: 'new.js', action: 'bash-move' }]);
});

test('extractBashFiles: chained mkdir + mv', () => {
  const r = extractBashFiles('mkdir -p docs && mv README.md docs/README.md');
  const paths = r.map((x) => `${x.action}:${x.path}`).sort();
  assert.deepEqual(paths, ['bash-mkdir:docs', 'bash-move:docs/README.md']);
});

test('extractBashFiles: ignores >&N file descriptor redirects', () => {
  assert.deepEqual(extractBashFiles('node x.js 2>&1 > /dev/null'), []);
});

test('extractBashFiles: ignores /dev/null', () => {
  assert.deepEqual(extractBashFiles('curl -s url > /dev/null'), []);
});

test('extractBashFiles: ignores paths inside quoted ssh wrappers', () => {
  const r = extractBashFiles("ssh host 'echo hi > /not/real.txt'");
  assert.deepEqual(r, []);
});

test('extractBashFiles: empty/null command is safe', () => {
  assert.deepEqual(extractBashFiles(''), []);
  assert.deepEqual(extractBashFiles(null), []);
  assert.deepEqual(extractBashFiles(undefined), []);
});
