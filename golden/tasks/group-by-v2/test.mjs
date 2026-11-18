import assert from 'node:assert/strict';
import { groupBy } from './solution.mjs';

assert.deepEqual(groupBy([{"g":"a"},{"g":"b"}], "g"), {"a":[{"g":"a"}],"b":[{"g":"b"}]});
assert.deepEqual(groupBy([{"g":"x"}], "g"), {"x":[{"g":"x"}]});
assert.deepEqual(groupBy([{"k":"z"},{"k":"y"}], "k"), {"z":[{"k":"z"}],"y":[{"k":"y"}]});
console.log('ok');
