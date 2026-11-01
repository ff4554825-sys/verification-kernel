import assert from 'node:assert/strict';
import { parseDuration } from './solution.mjs';

assert.deepEqual(parseDuration("5m"), 300);
assert.deepEqual(parseDuration("2h"), 7200);
assert.deepEqual(parseDuration("3h"), 10800);
console.log('ok');
