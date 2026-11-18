import assert from 'node:assert/strict';
import { getPath } from './solution.mjs';

assert.deepEqual(getPath({"a":{"b":1}}, "a.b"), 1);
assert.deepEqual(getPath({"a":{"b":2}}, "a.b"), 2);
assert.deepEqual(getPath({"x":3}, "x"), 3);
console.log('ok');
