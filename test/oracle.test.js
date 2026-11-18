import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RELATION, checkDecomposition, checkDeterminism, checkInvariance } from '../lib/oracle.js';

const run = promisify(execFile);

const plan = (checks) => ({ id: 'oracle-fixture', checks });
const check = (id, extra = {}) => ({ id, argv: ['node', '-e', 'process.exit(0)'], ...extra });

test('determinism passes when every run agrees', async () => {
  const verdict = await checkDeterminism({
    plan: plan([check('a'), check('b')]),
    cwd: process.cwd(),
    runs: 3,
    runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  });
  assert.equal(verdict.relation, RELATION.DETERMINISM);
  assert.equal(verdict.status, 'pass');
  assert.equal(verdict.details.observed.length, 3);
});

test('determinism catches a check that flips between runs', async () => {
  let call = 0;
  const verdict = await checkDeterminism({
    plan: plan([check('flaky'), check('stable')]),
    cwd: process.cwd(),
    runs: 3,
    runCommand: async (target) => {
      if (target.id === 'stable') return { exitCode: 0, stdout: '', stderr: '' };
      call += 1;
      return { exitCode: call % 2 === 0 ? 0 : 1, stdout: '', stderr: '' };
    },
  });
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.reason, /flaky/);
  // The verdict status flips too, so both the check and <verdict> diverge.
  assert.ok(verdict.details.diverged.includes('flaky'));
  assert.ok(verdict.details.diverged.includes('<verdict>'));
});

test('determinism catches a verdict that flips even when checks agree', async () => {
  let call = 0;
  const verdict = await checkDeterminism({
    plan: plan([check('only')]),
    cwd: process.cwd(),
    runs: 2,
    runCommand: async () => {
      call += 1;
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(verdict.status, 'pass');
  assert.equal(call, 2, 'the runner must actually be called once per run');
});

test('invariance passes when the verdict ignores ambient state', async () => {
  const verdict = await checkInvariance({
    plan: plan([check('a')]),
    cwd: process.cwd(),
    runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  });
  assert.equal(verdict.status, 'pass');
  assert.equal(verdict.details.variants.length, 2);
});

test('invariance catches a check that reads the clock timezone', async () => {
  const verdict = await checkInvariance({
    plan: plan([check('tz-dependent')]),
    cwd: process.cwd(),
    runCommand: async () => ({ exitCode: process.env.TZ === 'UTC' ? 0 : 1, stdout: '', stderr: '' }),
  });
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.reason, /ambient state/);
  assert.deepEqual(verdict.details.divergent, ['TZ=Pacific/Kiritimati']);
});

test('invariance applies the variant environment to every check, not just the first', async () => {
  // Regression: withEnv used to restore the environment at the first await
  // boundary, so only the first check saw the variant and a TZ-dependent check
  // in a later position was invisible to the oracle.
  const verdict = await checkInvariance({
    plan: plan([check('first'), check('second')]),
    cwd: process.cwd(),
    runCommand: async (target) => {
      if (target.id !== 'second') return { exitCode: 0, stdout: '', stderr: '' };
      return { exitCode: process.env.TZ === 'UTC' ? 0 : 1, stdout: '', stderr: '' };
    },
  });
  assert.equal(verdict.status, 'fail');
  assert.deepEqual(verdict.details.divergent, ['TZ=Pacific/Kiritimati']);
});

test('invariance restores the environment it touched', async () => {
  const before = process.env.TZ;
  await checkInvariance({
    plan: plan([check('a')]),
    cwd: process.cwd(),
    runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  });
  assert.equal(process.env.TZ, before);
});

test('decomposition passes when a composite agrees with its parts', async () => {
  const verdict = await checkDecomposition({
    plan: plan([check('unit'), check('integration', { composedOf: ['unit'] })]),
    cwd: process.cwd(),
    runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  });
  assert.equal(verdict.status, 'pass');
  assert.equal(verdict.details.composites.length, 1);
});

test('decomposition catches a composite that passes while its part failed', async () => {
  const verdict = await checkDecomposition({
    plan: plan([check('unit'), check('integration', { composedOf: ['unit'] })]),
    cwd: process.cwd(),
    runCommand: async (target) => ({ exitCode: target.id === 'unit' ? 1 : 0, stdout: '', stderr: '' }),
  });
  assert.equal(verdict.status, 'fail');
  assert.deepEqual(verdict.details.broken.map((entry) => entry.id), ['integration']);
});

test('decomposition reports unknown when nothing declares composedOf', async () => {
  const verdict = await checkDecomposition({
    plan: plan([check('a')]),
    cwd: process.cwd(),
    runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  });
  assert.equal(verdict.status, 'unknown');
  assert.match(verdict.reason, /no check declared composedOf/);
});

test('every oracle rejects a malformed plan instead of guessing', async () => {
  for (const call of [checkDeterminism, checkInvariance, checkDecomposition]) {
    await assert.rejects(
      call({ plan: { id: 'bad', checks: [{ id: 'x', argv: [] }] }, cwd: process.cwd(), runCommand: async () => ({}) }),
      /invalid plan/,
    );
  }
});

test('the CLI exits 1 when determinism fails on a real plan', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-oracle-'));
  try {
    const planFile = path.join(cwd, 'plan.json');
    const counter = path.join(cwd, 'count.txt');
    await fs.writeFile(planFile, JSON.stringify(plan([{
      id: 'toggler',
      argv: ['node', '-e', `const fs=require('node:fs');const n=(fs.existsSync(${JSON.stringify(counter)})?Number(fs.readFileSync(${JSON.stringify(counter)},'utf8')):0)+1;fs.writeFileSync(${JSON.stringify(counter)},String(n));process.exit(n%2);`],
    }])), 'utf8');

    await assert.rejects(
      run(process.execPath, [path.resolve('bin/oracle.js'), 'determinism', '--plan', planFile, '--cwd', cwd, '--runs', '3'], { timeout: 60_000 }),
      (error) => error.code === 1,
    );
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
