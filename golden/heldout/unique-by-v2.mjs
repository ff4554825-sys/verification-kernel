import assert from 'node:assert/strict';
import { uniqueBy } from './solution.mjs';

assert.deepEqual(uniqueBy([{"id":1,"v":"a"},{"id":2,"v":"b"},{"id":1,"v":"c"}], "id"), [{"id":1,"v":"a"},{"id":2,"v":"b"}]);
assert.deepEqual(uniqueBy([{"k":"x","v":1},{"k":"x","v":2}], "k"), [{"k":"x","v":1}]);
assert.deepEqual(uniqueBy([{"z":1,"n":"first"},{"z":1,"n":"last"}], "z"), [{"z":1,"n":"first"}]);
console.log('ok');
