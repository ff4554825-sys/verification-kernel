import assert from 'node:assert/strict';
import { sumEven } from './solution.mjs';

assert.deepEqual(sumEven([1,2,3,4]), 6);
assert.deepEqual(sumEven([]), 0);
assert.deepEqual(sumEven([2,4]), 6);
assert.deepEqual(sumEven([10,11,12]), 22);
console.log('ok');
