import assert from 'node:assert/strict';
import { parseDuration } from './solution.mjs';

assert.deepEqual(parseDuration("5m"), 300);
assert.deepEqual(parseDuration("2h"), 7200);
console.log('ok');
