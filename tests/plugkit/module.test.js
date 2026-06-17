import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineModule } from '../../packages/plugkit/src/module.js';

test('defineModule returns the definition unchanged when name is present', () => {
  const def = { name: 'my-module', version: '1.0' };
  const result = defineModule(def);
  assert.equal(result, def, 'should return the same object reference');
  assert.equal(result.name, 'my-module');
  assert.equal(result.version, '1.0');
});

test('defineModule throws when name is absent', () => {
  assert.throws(
    () => defineModule({}),
    /name.*required/i
  );
});

test('defineModule throws when called with no argument', () => {
  assert.throws(
    () => defineModule(),
    /name.*required/i
  );
});
