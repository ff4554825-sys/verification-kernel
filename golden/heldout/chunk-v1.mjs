import assert from 'node:assert/strict';
import { chunk } from './solution.mjs';

assert.deepEqual(chunk([1,2,3,4,5], 2), [[1,2],[3,4],[5]]);
assert.deepEqual(chunk([1,2,3], 2), [[1,2],[3]]);
console.log('ok');
