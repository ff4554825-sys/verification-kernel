import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyMutation, runMutations } from '../lib/mutation.js';

test('applyMutation requires a unique target', () => {
  assert.equal(applyMutation('a + b', { id: 'm', find: 'a + b', replace: 'a - b' }), 'a - b');
  assert.throws(() => applyMutation('a + b', { id: 'm', find: 'missing', replace: 'x' }), /not found/);
  assert.throws(() => applyMutation('x x', { id: 'm', find: 'x', replace: 'y' }), /not unique/);
});

test('runMutations distinguishes killed and survived mutants', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-mutation-fixture-'));
  await fs.writeFile(path.join(dir, 'mod.mjs'), 'export const add = (a, b) => a + b;\n', 'utf8');
  await fs.writeFile(path.join(dir, 'test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { add } from './mod.mjs';",
    "test('add', () => assert.equal(add(2, 3), 5));",
    '',
  ].join('\n'), 'utf8');
  const result = await runMutations({
    cwd: dir,
    testCommand: [process.execPath, '--test', 'test.mjs'],
    mutations: [
      { id: 'killed', file: 'mod.mjs', find: 'a + b', replace: 'a - b', description: 'flip addition' },
      { id: 'survived', file: 'mod.mjs', find: 'a + b', replace: 'a + b + 0', description: 'no-op change' },
    ],
  });
  assert.equal(result.killed, 1);
  assert.equal(result.survived, 1);
  assert.equal(result.score, 50);
  assert.equal(result.results.find((item) => item.id === 'killed').status, 'killed');
  assert.equal(result.results.find((item) => item.id === 'survived').status, 'survived');
  await fs.rm(dir, { recursive: true, force: true });
});
