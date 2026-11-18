import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeCoverage,
  formatFeedback,
  normalizePlan,
  renderVerdict,
  resummarize,
  runPlan,
} from '../lib/kernel.js';
import { outcomeFromVerdict } from '../lib/outcomes.js';

const check = (id, extra = {}) => ({ id, argv: ['node', '-e', 'process.exit(0)'], ...extra });

function planOf(checks) {
  return normalizePlan({ id: 'coverage', checks }).plan;
}

const passAll = async () => ({ exitCode: 0, stdout: '', stderr: '' });

test('a full run reports no skipped checks', async () => {
  const verdict = await runPlan(planOf([check('a'), check('b')]), { cwd: process.cwd(), runCommand: passAll });
  assert.deepEqual(verdict.coverage, {
    planned: 2, ran: 2, skipped: [], optionalFailed: [], optionalAsk: [], optionalUnknown: [], partial: false,
  });
  assert.equal(describeCoverage(verdict.coverage), '');
});

test('a fast-path selection is recorded, not silently applied', async () => {
  const verdict = await runPlan(planOf([check('unit'), check('golden'), check('syntax')]), {
    cwd: process.cwd(),
    runCommand: passAll,
    selectedCheckIds: ['syntax'],
    selectionReason: 'fast-path: documentation-only change',
  });
  assert.equal(verdict.status, 'pass');
  assert.equal(verdict.coverage.ran, 1);
  assert.equal(verdict.coverage.planned, 3);
  assert.equal(verdict.coverage.partial, true);
  assert.deepEqual(verdict.coverage.skipped.map((entry) => entry.id), ['unit', 'golden']);
  assert.equal(verdict.coverage.skipped[0].reason, 'fast-path: documentation-only change');
  assert.equal(verdict.coverage.skipped[0].required, true);

  const line = describeCoverage(verdict.coverage);
  assert.match(line, /1\/3 checks ran/);
  assert.match(line, /2 skipped \(fast-path: documentation-only change\): unit, golden/);
});

test('skipping only optional checks does not make the run partial', async () => {
  const verdict = await runPlan(planOf([check('unit'), check('lint', { required: false })]), {
    cwd: process.cwd(),
    runCommand: passAll,
    selectedCheckIds: ['unit'],
  });
  assert.equal(verdict.coverage.partial, false);
  assert.equal(verdict.coverage.skipped[0].required, false);
  assert.match(describeCoverage(verdict.coverage), /1 skipped \(selected-check-ids\)/);
});

test('a failing optional check is named even though the verdict passes', async () => {
  const verdict = await runPlan(planOf([check('unit'), check('lint', { required: false })]), {
    cwd: process.cwd(),
    runCommand: async (target) => ({ exitCode: target.id === 'lint' ? 1 : 0, stdout: '', stderr: '' }),
  });
  assert.equal(verdict.status, 'pass');
  assert.deepEqual(verdict.coverage.optionalFailed, ['lint']);
  assert.deepEqual(verdict.coverage.optionalAsk, []);
  assert.match(describeCoverage(verdict.coverage), /optional failed: lint/);
  const feedback = formatFeedback(verdict);
  assert.match(feedback, /passed for the checks that ran/);
  assert.match(feedback, /optional failed: lint/);
});

test('renderVerdict prints the coverage line only when something was skipped', async () => {
  const full = await runPlan(planOf([check('a')]), { cwd: process.cwd(), runCommand: passAll });
  assert.doesNotMatch(renderVerdict(full), /Coverage:/);

  const partial = await runPlan(planOf([check('a'), check('b')]), {
    cwd: process.cwd(),
    runCommand: passAll,
    selectedCheckIds: ['a'],
  });
  assert.match(renderVerdict(partial), /Coverage: 1\/2 checks ran/);
});

test('rescoring keeps the coverage the artifact recorded', async () => {
  const verdict = await runPlan(planOf([check('a'), check('b')]), {
    cwd: process.cwd(),
    runCommand: passAll,
    selectedCheckIds: ['a'],
    selectionReason: 'fast-path',
  });
  const rescored = resummarize(verdict);
  assert.deepEqual(rescored.coverage.skipped, verdict.coverage.skipped);
  assert.equal(rescored.coverage.partial, true);
});

test('the outcome record carries a compact coverage summary', async () => {
  const verdict = await runPlan(planOf([check('a'), check('b')]), {
    cwd: process.cwd(),
    runCommand: passAll,
    selectedCheckIds: ['a'],
  });
  const record = outcomeFromVerdict(verdict);
  assert.deepEqual(record.coverage, { planned: 2, ran: 1, skipped: 1, partial: true });
});

test('exit code 78 is an ask, not a failure and not an unknown', async () => {
  const { ASK_EXIT_CODE, gateAction } = await import('../lib/kernel.js');
  assert.equal(ASK_EXIT_CODE, 78);
  const plainFailure = await runPlan(planOf([check('plain')]), {
    cwd: process.cwd(),
    runCommand: async () => ({ exitCode: 3, stdout: '', stderr: '' }),
  });
  assert.equal(plainFailure.status, 'fail', 'exit 3 must stay a plain failure');
  const verdict = await runPlan(planOf([check('needs-human')]), {
    cwd: process.cwd(),
    runCommand: async () => ({ exitCode: 78, stdout: '', stderr: '' }),
  });
  assert.equal(verdict.status, 'ask');
  assert.equal(verdict.counts.requiredAsk, 1);
  assert.match(verdict.reason, /needs a human decision/);
  assert.deepEqual(gateAction(verdict, 0, 2), { action: 'allow', attempt: 0, reason: 'ask' });
  assert.match(formatFeedback(verdict), /needs a human decision/);
});

test('a failure outranks an ask, and one ask is enough for the verdict', async () => {
  const both = await runPlan(planOf([check('a'), check('b')]), {
    cwd: process.cwd(),
    runCommand: async (target) => ({ exitCode: target.id === 'a' ? 78 : 1, stdout: '', stderr: '' }),
  });
  assert.equal(both.status, 'fail');

  const onlyAsk = await runPlan(planOf([check('a'), check('b')]), {
    cwd: process.cwd(),
    runCommand: async (target) => ({ exitCode: target.id === 'a' ? 0 : 78, stdout: '', stderr: '' }),
  });
  assert.equal(onlyAsk.status, 'ask');
});

test('a check can tell a first attempt from a retry', async () => {
  const seen = [];
  const verdict = await runPlan(planOf([check('retry-me', { retries: 1 })]), {
    cwd: process.cwd(),
    runCommand: async (target, options) => {
      seen.push(options.attempt);
      return { exitCode: options.attempt === 0 ? 1 : 0, stdout: '', stderr: '' };
    },
  });
  assert.deepEqual(seen, [0, 1]);
  assert.equal(verdict.status, 'flaky');
  assert.deepEqual(verdict.checks[0].attemptStatuses, ['fail', 'pass']);
});

test('an optional check that asks is not filed as a failure', async () => {
  const verdict = await runPlan(planOf([
    check('ok'),
    check('failed-optional', { required: false }),
    check('ask-optional', { required: false }),
    check('unknown-optional', { required: false }),
  ]), {
    cwd: process.cwd(),
    runCommand: async (target) => {
      if (target.id === 'failed-optional') return { exitCode: 1, stdout: '', stderr: '' };
      if (target.id === 'ask-optional') return { exitCode: 78, stdout: '', stderr: '' };
      if (target.id === 'unknown-optional') return { exitCode: null, timedOut: true, stdout: '', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(verdict.status, 'pass', 'optional outcomes never decide the verdict');
  assert.deepEqual(verdict.coverage.optionalFailed, ['failed-optional']);
  assert.deepEqual(verdict.coverage.optionalAsk, ['ask-optional']);
  assert.deepEqual(verdict.coverage.optionalUnknown, ['unknown-optional']);
  const line = describeCoverage(verdict.coverage);
  assert.match(line, /optional failed: failed-optional/);
  assert.match(line, /optional needs a human: ask-optional/);
  assert.match(line, /optional unverified: unknown-optional/);
  assert.match(formatFeedback(verdict), /optional needs a human/);
});
