import assert from 'node:assert/strict';
import { clamp } from './solution.mjs';

assert.deepEqual(clamp(5, 10, 0), 5);
assert.deepEqual(clamp(7, 10, 0), 7);
assert.deepEqual(clamp(3, 10, 0), 3);
console.log('ok');
