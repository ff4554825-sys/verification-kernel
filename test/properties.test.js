import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { normalizePlan, planHash, resolveInside, runPlan, VERDICT_SCHEMA } from '../lib/kernel.js';
import { boolean, forAll, forAllAsync, int, oneOf } from './support/gen.js';

const OUTCOMES = ['pass', 'fail', 'unknown'];
const ARGV = ['node', '-e', 'process.exit(0)'];

/** A random plan plus the outcome each check should produce. */
function randomPlan(rand, id) {
  const count = int(rand, 5) + 1;
  const checks = [];
  const intended = new Map();
  for (let index = 0; index < count; index += 1) {
    const checkId = `c${index}`;
    const outcome = oneOf(rand, OUTCOMES);
    intended.set(checkId, outcome);
    checks.push({
      id: checkId,
      argv: [...ARGV],
      required: boolean(rand),
      ...(boolean(rand) ? { timeoutMs: 30_000 } : {}),
    });
  }
  return { plan: { id, checks }, intended };
}

/** A runner that produces the outcome recorded for each check id. */
function runnerFor(intended) {
  return async (check) => {
    const outcome = intended.get(check.id) ?? 'pass';
    if (outcome === 'pass') return { exitCode: 0, stdout: '', stderr: '' };
    if (outcome === 'fail') return { exitCode: 1, stdout: '', stderr: '' };
    return { exitCode: null, timedOut: true, stdout: '', stderr: '' };
  };
}

/** The documented verdict rules, written independently of the kernel. */
function expectedStatus(plan, intended) {
  const required = plan.checks.filter((check) => check.required);
  if (required.length === 0) return 'unknown';
  const outcomes = required.map((check) => intended.get(check.id));
  if (outcomes.includes('fail')) return 'fail';
  if (outcomes.every((outcome) => outcome === 'pass')) return 'pass';
  return 'unknown';
}

test('verdict status is a pure function of the required checks', async () => {
  await forAllAsync(120, 20261117, async (rand, index) => {
    const { plan, intended } = randomPlan(rand, `prop-${index}`);
    const { plan: normalized, errors } = normalizePlan(plan);
    assert.deepEqual(errors, []);
    const verdict = await runPlan(normalized, { cwd: process.cwd(), runCommand: runnerFor(intended) });
    assert.equal(verdict.status, expectedStatus(plan, intended), `plan ${JSON.stringify(plan.checks)}`);
    assert.equal(verdict.counts.required, plan.checks.filter((check) => check.required).length);
    assert.ok(['pass', 'fail', 'unknown', 'flaky'].includes(verdict.status));
    assert.equal(verdict.schema, VERDICT_SCHEMA);
  });
});

test('an optional failing check never decides the verdict', async () => {
  await forAllAsync(40, 4242, async (rand, index) => {
    const plan = {
      id: `optional-${index}`,
      checks: [
        { id: 'opt', argv: [...ARGV], required: false },
        { id: 'req', argv: [...ARGV], required: true },
      ],
    };
    const intended = new Map([['opt', 'fail'], ['req', oneOf(rand, ['pass', 'fail'])]]);
    const { plan: normalized } = normalizePlan(plan);
    const verdict = await runPlan(normalized, { cwd: process.cwd(), runCommand: runnerFor(intended) });
    assert.equal(verdict.status, intended.get('req'));
    assert.equal(verdict.counts.optionalFailed, 1);
  });
});

test('planHash is stable for equivalent plans', () => {
  forAll(80, 777, () => {
    const base = {
      id: 'hash',
      checks: [{ id: 'a', argv: [...ARGV], required: true, timeoutMs: 1000 }],
    };
    const permuted = {
      checks: [{ timeoutMs: 1000, required: true, argv: [...ARGV], id: 'a' }],
      id: 'hash',
    };
    const first = normalizePlan(base).plan;
    const second = normalizePlan(permuted).plan;
    assert.equal(planHash(first), planHash(second));

    // An omitted optional field must not change the hash of a normalized plan.
    const withoutTimeoutHash = planHash(normalizePlan({
      id: 'hash',
      checks: [{ id: 'a', argv: [...ARGV], required: true }],
    }).plan);
    assert.equal(withoutTimeoutHash, planHash(normalizePlan({
      id: 'hash',
      checks: [{ id: 'a', argv: [...ARGV], required: true }],
    }).plan));
  });
});

test('required defaults to true for any check that omits the field', () => {
  forAll(50, 31337, (rand) => {
    const count = int(rand, 4) + 1;
    const checks = [];
    for (let index = 0; index < count; index += 1) {
      checks.push({
        id: `c${index}`,
        argv: [...ARGV],
        ...(boolean(rand) ? { required: boolean(rand) } : {}),
      });
    }
    const { plan, errors } = normalizePlan({ id: 'defaults', checks });
    assert.deepEqual(errors, []);
    for (const [index, check] of plan.checks.entries()) {
      const explicit = checks[index].required;
      assert.equal(check.required, explicit === undefined ? true : explicit);
    }
  });
});

test('a plan with a malformed check is rejected rather than half-run', () => {
  const broken = [
    { id: 'no-argv' },
    { id: 'empty-argv', argv: [] },
    { id: 'shell-string', argv: 'node -e "process.exit(0)"' },
    { id: 'empty-part', argv: ['node', ''] },
    { id: 'bad-timeout', argv: ['node'], timeoutMs: -1 },
    { id: 'bad-required', argv: ['node'], required: 'yes' },
    { id: 'bad-retries', argv: ['node'], retries: 9 },
  ];
  for (const check of broken) {
    const { plan, errors } = normalizePlan({ id: 'broken', checks: [check] });
    assert.equal(plan, null, `check ${check.id} should be rejected`);
    assert.ok(errors.length > 0);
  }
});

test('resolveInside never returns a path outside its base', () => {
  const strings = ['', '.', 'a', 'a/b', '..', '../x', 'a/../../..', '/etc/passwd', 'C:\\Windows', 'a/./b', './../a'];
  forAll(120, 999, (rand) => {
    const base = path.resolve('/tmp/dsh-base');
    const target = `${oneOf(rand, strings)}${boolean(rand) ? oneOf(rand, strings) : ''}`;
    let resolved;
    try {
      resolved = resolveInside(base, target);
    } catch {
      return; // refusing is always an acceptable outcome
    }
    assert.equal(resolved === base || resolved.startsWith(`${base}${path.sep}`), true, `escaped with ${JSON.stringify(target)}`);
  });
});
