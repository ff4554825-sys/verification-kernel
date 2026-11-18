import assert from 'node:assert/strict';
import { range } from './solution.mjs';

assert.deepEqual(range(3, 0, -1), [3,2,1]);
assert.deepEqual(range(5, 0, -2), [5,3,1]);
assert.deepEqual(range(4, 0, -2), [4,2]);
console.log('ok');
