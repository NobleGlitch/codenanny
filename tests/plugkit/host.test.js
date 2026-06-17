import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../packages/plugkit/src/host.js';
import { freshDb } from '../helpers/db.js';

// Minimal Express-like stub
function makeApp() {
  return { use() {} };
}

test('createHost throws when app is missing', () => {
  assert.throws(
    () => createHost({ db: freshDb() }),
    /app.*required/i
  );
});

test('createHost throws when db is missing', () => {
  assert.throws(
    () => createHost({ app: makeApp() }),
    /db.*required/i
  );
});

test('register runs schema migrations — table exists afterwards', () => {
  const db = freshDb();
  const host = createHost({ app: makeApp(), db });

  host.register({
    name: 'test-migrations',
    schema: {
      migrations: [
        'CREATE TABLE IF NOT EXISTS test_widget (id INTEGER PRIMARY KEY, label TEXT)',
      ],
    },
  });

  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='test_widget'"
  ).get();
  assert.ok(row, 'test_widget table should exist after migration');
});

test('register refuses duplicate module name', () => {
  const host = createHost({ app: makeApp(), db: freshDb() });
  host.register({ name: 'alpha' });
  assert.throws(
    () => host.register({ name: 'alpha' }),
    /already registered/i
  );
});

test('getNav filters nav items by role', () => {
  const host = createHost({ app: makeApp(), db: freshDb() });

  host.register({
    name: 'mod-nav',
    nav: [
      { id: 'public-link', label: 'Public' },
      { id: 'admin-link', label: 'Admin', roles: ['admin'] },
    ],
  });

  const anonNav = host.getNav({ role: 'anon' });
  const adminNav = host.getNav({ role: 'admin' });

  assert.ok(anonNav.some((n) => n.id === 'public-link'), 'anon sees public nav');
  assert.ok(!anonNav.some((n) => n.id === 'admin-link'), 'anon does not see admin nav');
  assert.ok(adminNav.some((n) => n.id === 'admin-link'), 'admin sees admin nav');
});

test('events emitted by one module reach another module subscriber', () => {
  const host = createHost({ app: makeApp(), db: freshDb() });

  const received = [];

  host.register({
    name: 'listener',
    subscribe: {
      'data:ready': (payload) => received.push(payload),
    },
  });

  host.register({ name: 'emitter' });

  host.events.emit('data:ready', { value: 99 });

  assert.equal(received.length, 1);
  assert.equal(received[0].value, 99);
});
