import assert from 'node:assert/strict';
import { slugify } from './solution.mjs';

assert.deepEqual(slugify("--Hi--"), "hi");
assert.deepEqual(slugify("  A  B  "), "a-b");
assert.deepEqual(slugify("((Hi))"), "hi");
console.log('ok');
