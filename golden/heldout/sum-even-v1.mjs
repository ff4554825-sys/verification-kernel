import assert from 'node:assert/strict';
import { sumEven } from './solution.mjs';

assert.deepEqual(sumEven([-2,4,5]), 2);
assert.deepEqual(sumEven([-3,-1]), 0);
console.log('ok');
