import assert from 'node:assert/strict';
import { getPath } from './solution.mjs';

assert.deepEqual(getPath({"items":[{"id":1}]}, "items.0.id"), 1);
assert.deepEqual(getPath({"list":[10,20]}, "list.1"), 20);
assert.deepEqual(getPath({"rows":[{"v":7}]}, "rows.0.v"), 7);
console.log('ok');
