import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAdapter } from '../../packages/adapters/index.js';

test('getAdapter("local") returns an object with a deliver function', () => {
  const adapter = getAdapter('local');
  assert.ok(adapter, 'adapter should be truthy');
  assert.equal(typeof adapter.deliver, 'function', 'adapter should have a deliver function');
});

test('getAdapter("unknown") throws an error naming the known adapters', () => {
  assert.throws(
    () => getAdapter('unknown'),
    (err) => {
      assert.ok(err instanceof Error, 'should throw an Error');
      assert.ok(err.message.includes('local'),   'error message should mention "local"');
      assert.ok(err.message.includes('unknown'), 'error message should mention the bad type');
      return true;
    }
  );
});
