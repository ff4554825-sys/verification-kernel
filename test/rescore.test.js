import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizePlan, resummarize, runPlan } from '../lib/kernel.js';
import { writeVerdictArtifacts } from '../lib/artifacts.js';

const run = promisify(execFile);

const rescoreBin = path.resolve('bin/rescore.js');

function stored(overrides = {}) {
  return {
    version: 1,
    schema: 2,
    id: 'rescore-fixture',
    planHash: 'deadbeef',
    status: 'pass',
    reason: 'all required checks passed',
    startedAt: 1,
    finishedAt: 2,
    cwd: '',
    checks: [],
    ...overrides,
  };
}

test('resummarize recomputes status from stored checks', () => {
  const verdict = resummarize(stored({
    checks: [
      { id: 'a', required: true, status: 'pass', durationMs: 1 },
      { id: 'b', required: true, status: 'fail', exitCode: 1, durationMs: 1 },
    ],
  }));
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.reason, /1 required check failed/);
  assert.equal(verdict.rescoredFrom.status, 'pass');
  assert.equal(verdict.rescoredFrom.staleSchema, false);
  assert.equal(verdict.planHash, 'deadbeef');
  assert.equal(verdict.id, 'rescore-fixture');
});

test('resummarize flags evidence written by an older schema', () => {
  const verdict = resummarize(stored({ schema: 1, checks: [{ id: 'a', required: true, status: 'pass', durationMs: 1 }] }));
  assert.equal(verdict.rescoredFrom.staleSchema, true);
});

test('resummarize rejects anything that is not a stored verdict', () => {
  assert.throws(() => resummarize(null), /requires a stored verdict/);
  assert.throws(() => resummarize({ id: 'x' }), /requires a stored verdict/);
  assert.throws(() => resummarize({ checks: 'nope' }), /requires a stored verdict/);
});

test('resummarize applies the current unknown policy to old evidence', () => {
  const verdict = resummarize(stored({
    checks: [{ id: 'slow', required: true, status: 'unknown', reason: 'timeout', durationMs: 5 }],
  }));
  assert.equal(verdict.status, 'unknown');
  assert.deepEqual(verdict.unknownReasons, { timeout: 1 });
  assert.equal(verdict.counts.requiredUnknownByReason.timeout, 1);
});

test('rescore reads an artifact written by a real run and agrees with it', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rescore-'));
  try {
    const { plan } = normalizePlan({
      id: 'rescore-roundtrip',
      checks: [{ id: 'ok', argv: ['node', '-e', 'process.exit(0)'] }],
    });
    const verdict = await runPlan(plan, {
      cwd,
      runCommand: async () => ({ exitCode: 0, stdout: 'fine', stderr: '' }),
    });
    const artifacts = await writeVerdictArtifacts(cwd, verdict);
    assert.notEqual(artifacts, null);
    const raw = JSON.parse(await fs.readFile(artifacts.latest, 'utf8'));
    assert.equal(raw.schema, 2);

    const artifactDir = path.join(cwd, '.dsh', 'verification');
    const { stdout } = await run(process.execPath, [rescoreBin, '--run', artifactDir, '--json'], { timeout: 30_000 });
    const result = JSON.parse(stdout);
    assert.equal(result.status, 'pass');
    assert.equal(result.originalStatus, 'pass');
    assert.equal(result.changed, false);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('rescore never executes a check, even one with side effects', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rescore-noexec-'));
  try {
    const marker = path.join(cwd, 'marker.txt');
    const planFile = path.join(cwd, 'latest.json');
    await fs.writeFile(planFile, JSON.stringify(stored({
      cwd,
      checks: [{
        id: 'side-effect',
        required: true,
        status: 'pass',
        durationMs: 1,
        argv: ['node', '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x')`],
      }],
    })), 'utf8');

    await run(process.execPath, [rescoreBin, '--file', planFile, '--json'], { timeout: 30_000 });
    await assert.rejects(fs.access(marker), /ENOENT/);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('rescore exits 1 for a failing verdict and 2 for an unknown one', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rescore-exit-'));
  try {
    const failFile = path.join(cwd, 'fail.json');
    await fs.writeFile(failFile, JSON.stringify(stored({
      status: 'pass',
      checks: [{ id: 'b', required: true, status: 'fail', exitCode: 2, durationMs: 1 }],
    })), 'utf8');
    await assert.rejects(
      run(process.execPath, [rescoreBin, '--file', failFile], { timeout: 30_000 }),
      (error) => error.code === 1,
    );

    const unknownFile = path.join(cwd, 'unknown.json');
    await fs.writeFile(unknownFile, JSON.stringify(stored({
      checks: [{ id: 'u', required: true, status: 'unknown', reason: 'env-missing', durationMs: 1 }],
    })), 'utf8');
    await assert.rejects(
      run(process.execPath, [rescoreBin, '--file', unknownFile], { timeout: 30_000 }),
      (error) => error.code === 2,
    );
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('rescore --expect fails when the reassessed status disagrees', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rescore-expect-'));
  try {
    const file = path.join(cwd, 'latest.json');
    await fs.writeFile(file, JSON.stringify(stored({
      checks: [{ id: 'b', required: true, status: 'fail', exitCode: 1, durationMs: 1 }],
    })), 'utf8');
    await assert.rejects(
      run(process.execPath, [rescoreBin, '--file', file, '--expect', 'pass'], { timeout: 30_000 }),
      (error) => error.code === 1,
    );
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('rescore --write leaves the signed artifact untouched', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rescore-write-'));
  try {
    const file = path.join(cwd, 'latest.json');
    const original = JSON.stringify(stored({
      checks: [{ id: 'a', required: true, status: 'pass', durationMs: 1 }],
    }), null, 2);
    await fs.writeFile(file, original, 'utf8');

    await run(process.execPath, [rescoreBin, '--file', file, '--write', '--json'], { timeout: 30_000 });
    assert.equal(await fs.readFile(file, 'utf8'), original);
    const rescored = JSON.parse(await fs.readFile(path.join(cwd, 'latest.rescored.json'), 'utf8'));
    assert.equal(rescored.rescoredFrom.status, 'pass');
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
