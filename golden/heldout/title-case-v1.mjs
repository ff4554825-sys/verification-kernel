import assert from 'node:assert/strict';
import { titleCase } from './solution.mjs';

assert.deepEqual(titleCase("hello world"), "Hello World");
assert.deepEqual(titleCase("multi word title"), "Multi Word Title");
console.log('ok');
