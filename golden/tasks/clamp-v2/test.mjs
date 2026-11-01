import assert from 'node:assert/strict';
import { clamp } from './solution.mjs';

assert.deepEqual(clamp(5, 0, 10), 5);
assert.deepEqual(clamp(-1, 0, 10), 0);
assert.deepEqual(clamp(11, 0, 10), 10);
assert.deepEqual(clamp(7, 0, 10), 7);
console.log('ok');
