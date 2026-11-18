import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNKNOWN_REASON,
  UNKNOWN_REASON_GATE,
  classifyUnknown,
  gateAction,
  gateUnknownReason,
  normalizePlan,
  runPlan,
  unknownReasonCounts,
} from '../lib/kernel.js';
import { outcomeFromVerdict } from '../lib/outcomes.js';

function plan(checks) {
  return { id: 'reason-plan', checks };
}

const check = (id, extra = {}) => ({ id, argv: ['node', '-e', 'process.exit(0)'], ...extra });

test('classifyUnknown separates timeout, missing executable, and spawn failure', () => {
  assert.equal(classifyUnknown({ timedOut: true, exitCode: null }), UNKNOWN_REASON.TIMEOUT);
  assert.equal(
    classifyUnknown({ exitCode: null, error: { name: 'Error', code: 'ENOENT', message: 'spawn x ENOENT' } }),
    UNKNOWN_REASON.ENV_MISSING,
  );
  assert.equal(
    classifyUnknown({ exitCode: null, error: { name: 'ENOENT', message: 'missing' } }),
    UNKNOWN_REASON.ENV_MISSING,
  );
  assert.equal(
    classifyUnknown({ exitCode: null, error: { name: 'Error', message: 'EACCES' } }),
    UNKNOWN_REASON.SPAWN,
  );
  assert.equal(classifyUnknown({ exitCode: null }), UNKNOWN_REASON.SPAWN);
});

test('runPlan records the unknown reason on the check and on the verdict', async () => {
  const { plan: normalized } = normalizePlan(plan([check('slow'), check('gone')]));
  const verdict = await runPlan(normalized, {
    cwd: process.cwd(),
    runCommand: async (target) => (target.id === 'slow'
      ? { exitCode: null, timedOut: true, stdout: '', stderr: '' }
      : { exitCode: null, error: { name: 'Error', code: 'ENOENT', message: 'spawn gone ENOENT' }, stdout: '', stderr: '' }),
  });
  assert.equal(verdict.status, 'unknown');
  assert.equal(verdict.schema, 2);
  assert.deepEqual(verdict.unknownReasons, { timeout: 1, 'env-missing': 1 });
  assert.deepEqual(verdict.counts.requiredUnknownByReason, { timeout: 1, 'env-missing': 1 });
  assert.equal(verdict.checks.find((entry) => entry.id === 'slow').reason, 'timeout');
  assert.equal(verdict.checks.find((entry) => entry.id === 'gone').reason, 'env-missing');
});

test('a plan with no required checks reports no-required-checks', async () => {
  const { plan: normalized } = normalizePlan(plan([check('optional', { required: false })].map((entry) => ({ ...entry, required: false }))));
  const verdict = await runPlan(normalized, {
    cwd: process.cwd(),
    runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  });
  assert.equal(verdict.status, 'unknown');
  assert.deepEqual(verdict.unknownReasons, { 'no-required-checks': 1 });
});

test('unknownReasonCounts ignores passing and optional checks', () => {
  assert.deepEqual(unknownReasonCounts([
    { status: 'unknown', required: true, reason: 'timeout' },
    { status: 'unknown', required: true, reason: 'timeout' },
    { status: 'unknown', required: false, reason: 'timeout' },
    { status: 'pass', required: true },
    { status: 'unknown', required: true, reason: 'not-a-reason' },
  ]), { timeout: 2, spawn: 1 });
});

test('the gate policy separates retryable from non-retryable unknowns', () => {
  assert.equal(UNKNOWN_REASON_GATE[UNKNOWN_REASON.TIMEOUT], 'steer');
  assert.equal(UNKNOWN_REASON_GATE[UNKNOWN_REASON.SPAWN], 'allow');
  assert.equal(UNKNOWN_REASON_GATE[UNKNOWN_REASON.INVALID_CWD], 'steer');
  assert.equal(UNKNOWN_REASON_GATE[UNKNOWN_REASON.ENV_MISSING], 'allow');
  assert.equal(UNKNOWN_REASON_GATE[UNKNOWN_REASON.ABORTED], 'allow');
  assert.equal(UNKNOWN_REASON_GATE[UNKNOWN_REASON.NO_REQUIRED_CHECKS], 'allow');
  assert.equal(UNKNOWN_REASON_GATE[UNKNOWN_REASON.POLICY], 'allow');
});

test('gateUnknownReason prefers a retryable reason over a terminal one', () => {
  assert.equal(gateUnknownReason({ status: 'unknown', unknownReasons: { 'env-missing': 2, timeout: 1 } }), 'timeout');
  assert.equal(gateUnknownReason({ status: 'unknown', unknownReasons: { spawn: 1 } }), 'spawn');
  assert.equal(gateUnknownReason({ status: 'unknown', unknownReasons: { 'env-missing': 2 } }), 'env-missing');
  assert.equal(gateUnknownReason({ status: 'unknown' }), null);
  assert.equal(gateUnknownReason({ status: 'unknown', unknownReasons: { bogus: 1 } }), null);
  assert.equal(gateUnknownReason(null), null);
});

test('gateAction steers a retryable unknown and allows a terminal one', () => {
  const timeout = { status: 'unknown', unknownReasons: { timeout: 1 } };
  assert.deepEqual(gateAction(timeout, 0, 2), { action: 'steer', attempt: 1, reason: 'unknown-timeout' });
  assert.deepEqual(gateAction(timeout, 1, 2), { action: 'steer', attempt: 2, reason: 'unknown-timeout' });
  assert.deepEqual(gateAction(timeout, 2, 2), { action: 'steer-final', attempt: 3, reason: 'exhausted' });
  assert.deepEqual(gateAction(timeout, 3, 2), { action: 'allow', attempt: 3, reason: 'exhausted' });
  assert.deepEqual(gateAction(timeout, 0, 0), { action: 'allow', attempt: 0, reason: 'no-retry' });

  const missing = { status: 'unknown', unknownReasons: { 'env-missing': 1 } };
  assert.deepEqual(gateAction(missing, 0, 2), { action: 'allow', attempt: 0, reason: 'unknown' });

  // A verdict from before reason codes carries no map: keep the old contract.
  assert.deepEqual(gateAction({ status: 'unknown' }, 0, 2), { action: 'allow', attempt: 0, reason: 'unknown' });
});

test('the outcome record carries the unknown reason counts', async () => {
  const { plan: normalized } = normalizePlan(plan([check('slow')]));
  const verdict = await runPlan(normalized, {
    cwd: process.cwd(),
    runCommand: async () => ({ exitCode: null, timedOut: true, stdout: '', stderr: '' }),
  });
  const record = outcomeFromVerdict(verdict);
  assert.deepEqual(record.unknownReasons, { timeout: 1 });
  assert.equal(record.checksDetail.length, 1);
  const detail = record.checksDetail[0];
  assert.equal(detail.id, 'slow');
  assert.equal(detail.required, true);
  assert.equal(detail.status, 'unknown');
  assert.equal(detail.reason, 'timeout');
  assert.equal(detail.attempts, 1);
  // Wall-clock, so assert the shape rather than an exact value.
  assert.equal(Number.isInteger(detail.durationMs) && detail.durationMs >= 0, true);
});
