import assert from 'node:assert/strict';
import { slugify } from './solution.mjs';

assert.deepEqual(slugify("--Hi--"), "hi");
assert.deepEqual(slugify("  A  B  "), "a-b");
console.log('ok');
