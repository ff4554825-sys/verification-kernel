import assert from 'node:assert/strict';
import { uniqueBy } from './solution.mjs';

assert.deepEqual(uniqueBy([{"id":1,"v":"a"},{"id":1,"v":"a"},{"id":2,"v":"b"}], "id"), [{"id":1,"v":"a"},{"id":2,"v":"b"}]);
assert.deepEqual(uniqueBy([{"k":"x"},{"k":"x"}], "k"), [{"k":"x"}]);
assert.deepEqual(uniqueBy([{"z":1},{"z":2}], "z"), [{"z":1},{"z":2}]);
console.log('ok');
