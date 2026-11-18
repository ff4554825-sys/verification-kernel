import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runVerificationWorkflow, WORKFLOW_PHASES } from '../lib/workflow.js';
import { verifyVerdict } from '../lib/sign.js';

async function fixture(exitCode) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-workflow-'));
  await fs.writeFile(path.join(dir, 'plan.json'), JSON.stringify({
    id: 'workflow-demo',
    checks: [{
      id: 'ok',
      argv: [process.execPath, '-e', `process.exit(${exitCode})`],
      required: true,
    }],
  }), 'utf8');
  return dir;
}

test('verification workflow runs resolve/execute/evidence/gate/report', async () => {
  const dir = await fixture(0);
  const result = await runVerificationWorkflow({
    cwd: dir,
    planPath: 'plan.json',
    project: 'demo',
    mode: 'enforce',
    maxAttempts: 2,
    outcomeStore: '.dsh/verification/outcomes.jsonl',
  });
  assert.equal(result.ok, true);
  assert.equal(result.verdict.status, 'pass');
  assert.equal(result.gate.action, 'allow');
  assert.equal(result.gate.reason, 'passed');
  assert.deepEqual(result.phases.map((phase) => phase.name), WORKFLOW_PHASES);
  assert.match(result.workflowPath, /workflow\.json$/);
  const record = JSON.parse(await fs.readFile(result.workflowPath, 'utf8'));
  assert.equal(record.project, 'demo');
  assert.equal(record.verdict.status, 'pass');
  const outcomes = await fs.readFile(path.join(dir, '.dsh', 'verification', 'outcomes.jsonl'), 'utf8');
  assert.equal(JSON.parse(outcomes.trim()).project, 'demo');
  await fs.rm(dir, { recursive: true, force: true });
});

test('verification workflow records a failure and dry-run gate', async () => {
  const dir = await fixture(1);
  const result = await runVerificationWorkflow({
    cwd: dir,
    planPath: 'plan.json',
    mode: 'dry-run',
    outcomeStore: '',
  });
  assert.equal(result.ok, false);
  assert.equal(result.verdict.status, 'fail');
  assert.equal(result.gate.action, 'record');
  assert.equal(result.gate.reason, 'dry-run');
  assert.equal(result.phases.at(-1).name, 'report');
  await fs.rm(dir, { recursive: true, force: true });
});

test('verification workflow can sign the verdict and write it', async () => {
  const dir = await fixture(0);
  const keygen = await import('node:child_process');
  const execFile = keygen.execFile;
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  await run(process.execPath, [path.resolve('bin/verification-keygen.js'), '--out-dir', dir, '--json']);
  const publicKey = await fs.readFile(path.join(dir, 'verification.pub'), 'utf8');
  const result = await runVerificationWorkflow({
    cwd: dir,
    planPath: 'plan.json',
    signKey: 'verification.key',
    outcomeStore: '',
  });
  assert.equal(result.signed, true);
  assert.equal(verifyVerdict(result.verdict, publicKey), true);
  const latest = JSON.parse(await fs.readFile(path.join(dir, '.dsh', 'verification', 'latest.json'), 'utf8'));
  assert.equal(verifyVerdict(latest, publicKey), true);
  await fs.rm(dir, { recursive: true, force: true });
});
