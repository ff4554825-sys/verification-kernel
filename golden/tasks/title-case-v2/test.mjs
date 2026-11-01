import assert from 'node:assert/strict';
import { titleCase } from './solution.mjs';

assert.deepEqual(titleCase("hello"), "Hello");
assert.deepEqual(titleCase("DSH"), "Dsh");
assert.deepEqual(titleCase("code"), "Code");
console.log('ok');
