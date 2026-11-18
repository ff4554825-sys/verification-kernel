import assert from 'node:assert/strict';
import { slugify } from './solution.mjs';

assert.deepEqual(slugify("Hello World"), "hello-world");
assert.deepEqual(slugify("DSH 2026"), "dsh-2026");
assert.deepEqual(slugify("A B"), "a-b");
console.log('ok');
