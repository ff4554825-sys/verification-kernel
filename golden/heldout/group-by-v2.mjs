import assert from 'node:assert/strict';
import { groupBy } from './solution.mjs';

assert.deepEqual(groupBy([{"g":"a","v":1},{"g":"a","v":2}], "g"), {"a":[{"g":"a","v":1},{"g":"a","v":2}]});
assert.deepEqual(groupBy([{"g":"b","v":1},{"g":"b","v":2},{"g":"c","v":3}], "g"), {"b":[{"g":"b","v":1},{"g":"b","v":2}],"c":[{"g":"c","v":3}]});
assert.deepEqual(groupBy([{"k":"q","v":1},{"k":"q","v":2}], "k"), {"q":[{"k":"q","v":1},{"k":"q","v":2}]});
console.log('ok');
