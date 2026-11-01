/**
 * Golden benchmark for the verification kernel.
 *
 * It runs two policies over 20 generated tasks:
 *   - visible-only: only the test the implementer can see
 *   - full: visible + held-out test
 *
 * The good candidate must pass; both bad candidates must fail under `full`.
 * `bad-hidden` is designed to pass `visible-only`, which demonstrates the
 * value of independent checks. This measures verifier mechanics, not a model.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runPlan } from '../lib/kernel.js';
import { runCommand } from '../lib/exec.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await fs.readFile(path.join(here, 'manifest.json'), 'utf8'));
const candidates = ['good', 'bad-visible', 'bad-hidden'];
const policies = ['visible-only', 'full'];
const runs = [];

async function removeRunFiles(taskDir) {
  await fs.rm(path.join(taskDir, 'solution.mjs'), { force: true });
  await fs.rm(path.join(taskDir, 'heldout.mjs'), { force: true });
}

async function runOne(task, candidate, policy) {
  const taskDir = path.join(here, task.dir);
  await removeRunFiles(taskDir);
  try {
    await fs.copyFile(path.join(taskDir, task.candidates[candidate]), path.join(taskDir, 'solution.mjs'));
    if (policy === 'full') {
      await fs.copyFile(path.join(here, 'heldout', `${task.id}.mjs`), path.join(taskDir, 'heldout.mjs'));
    }
    const plan = policy === 'full' ? task.plan : task.visibleOnlyPlan;
    const startedAt = Date.now();
    const verdict = await runPlan(plan, { cwd: taskDir, runCommand });
    return {
      task: task.id,
      candidate,
      policy,
      status: verdict.status,
      reason: verdict.reason,
      wallMs: Date.now() - startedAt,
      checks: verdict.checks.map((check) => ({
        id: check.id,
        status: check.status,
        exitCode: check.exitCode,
        durationMs: Math.round(check.durationMs),
      })),
    };
  } finally {
    await removeRunFiles(taskDir);
  }
}

for (const task of manifest.tasks) {
  for (const candidate of candidates) {
    for (const policy of policies) {
      runs.push(await runOne(task, candidate, policy));
    }
  }
}

function summarize(policy) {
  const rows = runs.filter((run) => run.policy === policy);
  const good = rows.filter((run) => run.candidate === 'good');
  const bad = rows.filter((run) => run.candidate !== 'good');
  const goodRejected = good.filter((run) => run.status !== 'pass');
  const badAccepted = bad.filter((run) => run.status === 'pass');
  const byCandidate = {};
  for (const candidate of candidates) {
    const subset = rows.filter((run) => run.candidate === candidate);
    byCandidate[candidate] = {
      total: subset.length,
      pass: subset.filter((run) => run.status === 'pass').length,
      fail: subset.filter((run) => run.status === 'fail').length,
      unknown: subset.filter((run) => run.status === 'unknown').length,
    };
  }
  return {
    total: rows.length,
    pass: rows.filter((run) => run.status === 'pass').length,
    fail: rows.filter((run) => run.status === 'fail').length,
    unknown: rows.filter((run) => run.status === 'unknown').length,
    goodTotal: good.length,
    goodRejected: goodRejected.length,
    badTotal: bad.length,
    badAccepted: badAccepted.length,
    falseRejectRate: good.length === 0 ? 0 : goodRejected.length / good.length,
    falseAcceptRate: bad.length === 0 ? 0 : badAccepted.length / bad.length,
    byCandidate,
  };
}

const metrics = { 'visible-only': summarize('visible-only'), full: summarize('full') };

const robustnessDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-vk-robust-'));
const robustnessCases = [
  {
    id: 'timeout',
    expected: 'unknown',
    plan: { id: 'timeout', checks: [{ id: 'slow', argv: ['node', '-e', 'setTimeout(() => {}, 5000)'], required: true, timeoutMs: 100 }] },
  },
  {
    id: 'spawn-error',
    expected: 'unknown',
    plan: { id: 'spawn-error', checks: [{ id: 'missing', argv: ['definitely-not-a-real-binary-xyz'], required: true, timeoutMs: 5_000 }] },
  },
  {
    id: 'empty-plan',
    expected: 'unknown',
    plan: { id: 'empty-plan', checks: [] },
  },
  {
    id: 'nonzero',
    expected: 'fail',
    plan: { id: 'nonzero', checks: [{ id: 'exit', argv: ['node', '-e', 'process.exit(3)'], required: true, timeoutMs: 5_000 }] },
  },
];
const robustness = [];
try {
  for (const testCase of robustnessCases) {
    const verdict = await runPlan(testCase.plan, { cwd: robustnessDir, runCommand });
    robustness.push({
      id: testCase.id,
      expected: testCase.expected,
      actual: verdict.status,
      ok: verdict.status === testCase.expected,
      checks: verdict.checks.map((check) => ({ id: check.id, status: check.status, timedOut: check.timedOut, error: check.error })),
    });
  }
} finally {
  await fs.rm(robustnessDir, { recursive: true, force: true });
}

const results = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  tasks: manifest.tasks.length,
  candidateRuns: runs.length,
  metrics,
  robustness,
  runs,
};
await fs.writeFile(path.join(here, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);

function formatRate(value) {
  return `${(value * 100).toFixed(1)}%`;
}

console.log(`Golden set: ${manifest.tasks.length} tasks, ${runs.length} candidate runs, ${robustness.length} robustness probes`);
console.log('');
console.log('policy        pass  fail  unknown  false-reject   false-accept');
for (const policy of policies) {
  const metric = metrics[policy];
  console.log(
    `${policy.padEnd(13)} ${String(metric.pass).padStart(4)}  ${String(metric.fail).padStart(4)}  ${String(metric.unknown).padStart(7)}  ${`${metric.goodRejected}/${metric.goodTotal} (${formatRate(metric.falseRejectRate)})`.padEnd(14)} ${`${metric.badAccepted}/${metric.badTotal} (${formatRate(metric.falseAcceptRate)})`}`,
  );
}
console.log('');
for (const policy of policies) {
  const parts = candidates.map((candidate) => {
    const row = metrics[policy].byCandidate[candidate];
    return `${candidate}: ${row.pass}/${row.total} pass`;
  });
  console.log(`${policy.padEnd(13)} ${parts.join(' · ')}`);
}
console.log('');
console.log('robustness');
for (const probe of robustness) {
  console.log(`- ${probe.id}: ${probe.actual} (expected ${probe.expected}) ${probe.ok ? 'ok' : 'MISMATCH'}`);
}

const full = metrics.full;
const failed = full.goodRejected !== 0 || full.badAccepted !== 0 || full.unknown !== 0 || robustness.some((probe) => !probe.ok);
process.exitCode = failed ? 1 : 0;
