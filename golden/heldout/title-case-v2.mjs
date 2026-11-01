import assert from 'node:assert/strict';
import { titleCase } from './solution.mjs';

assert.deepEqual(titleCase("hello world"), "Hello World");
assert.deepEqual(titleCase("multi word title"), "Multi Word Title");
assert.deepEqual(titleCase("hello there"), "Hello There");
console.log('ok');
