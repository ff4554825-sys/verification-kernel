import assert from 'node:assert/strict';
import { parseDuration } from './solution.mjs';

assert.deepEqual(parseDuration("30s"), 30);
assert.deepEqual(parseDuration("bad"), null);
console.log('ok');
