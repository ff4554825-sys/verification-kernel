import assert from 'node:assert/strict';
import { range } from './solution.mjs';

assert.deepEqual(range(0, 3), [0,1,2]);
assert.deepEqual(range(1, 4, 2), [1,3]);
assert.deepEqual(range(0, 5, 2), [0,2,4]);
assert.deepEqual(range(2, 5), [2,3,4]);
console.log('ok');
