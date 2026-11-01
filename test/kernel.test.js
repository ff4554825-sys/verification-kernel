import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeCheck,
  normalizePlan,
  runPlan,
  gateAction,
  formatFeedback,
  formatFinalFeedback,
  renderVerdict,
  isInside,
  resolveInside,
  tailText,
  hashValue,
  planHash,
  evidenceFromResult,
  clampText,
} from '../lib/kernel.js';
import { redactSensitive } from '../lib/redact.js';
import { runCommand } from '../lib/exec.js';

const commandResult = (overrides = {}) => ({
  exitCode: 0,
  signal: null,
  stdout: '',
  stderr: '',
  durationMs: 5,
  timedOut: false,
  error: null,
  ...overrides,
});

test('normalizePlan accepts a valid plan and default timeout', () => {
  const { plan, errors } = normalizePlan({
    id: 'demo',
    checks: [{ id: 'visible', argv: ['node', 'test.mjs'] }],
  });
  assert.deepEqual(errors, []);
  assert.equal(plan.id, 'demo');
  assert.equal(plan.checks[0].timeoutMs, 60_000);
  assert.equal(plan.checks[0].required, true);
});

test('normalizePlan rejects empty argv and empty plans', () => {
  assert.equal(normalizePlan({ checks: [{ id: 'x', argv: [] }] }).plan, null);
  assert.equal(normalizePlan({ checks: [] }).plan, null);
  const invalid = normalizePlan({ checks: [{ id: 'x', argv: ['node'], timeoutMs: 0 }] });
  assert.equal(invalid.plan, null);
  assert.ok(invalid.errors.some((message) => message.includes('timeoutMs')));
});

test('runPlan passes required checks and records evidence', async () => {
  const { plan } = normalizePlan({
    id: 'pass',
    checks: [
      { id: 'a', argv: ['node', 'a.mjs'] },
      { id: 'b', argv: ['node', 'b.mjs'], required: false },
    ],
  });
  const verdict = await runPlan(plan, {
    cwd: process.cwd(),
    runCommand: async (check) => commandResult({ stdout: `ran ${check.id}` }),
  });
  assert.equal(verdict.status, 'pass');
  assert.equal(verdict.counts.required, 1);
  assert.equal(verdict.checks[0].stdout, 'ran a');
  assert.equal(verdict.checks[1].status, 'pass');
});

test('runPlan fails on a required failure and ignores optional failures', async () => {
  const failing = async (check) => commandResult({ exitCode: check.id === 'bad' ? 1 : 0, stdout: check.id });
  const requiredBad = normalizePlan({ checks: [{ id: 'bad', argv: ['node', 'x'] }] }).plan;
  assert.equal((await runPlan(requiredBad, { cwd: process.cwd(), runCommand: failing })).status, 'fail');

  const optionalBad = normalizePlan({
    checks: [
      { id: 'good', argv: ['node', 'x'] },
      { id: 'bad', argv: ['node', 'y'], required: false },
    ],
  }).plan;
  const verdict = await runPlan(optionalBad, { cwd: process.cwd(), runCommand: failing });
  assert.equal(verdict.status, 'pass');
  assert.equal(verdict.counts.optionalFailed, 1);
});

test('runPlan marks pass-after-failure as flaky and allows the gate', async () => {
  const { plan } = normalizePlan({
    checks: [{ id: 'flaky', argv: ['node', 'x'], retries: 1 }],
  });
  let calls = 0;
  const verdict = await runPlan(plan, {
    cwd: process.cwd(),
    runCommand: async () => {
      calls += 1;
      return commandResult({ exitCode: calls === 1 ? 1 : 0 });
    },
  });
  assert.equal(calls, 2);
  assert.equal(verdict.status, 'flaky');
  assert.equal(verdict.checks[0].attempts, 2);
  assert.deepEqual(verdict.checks[0].attemptStatuses, ['fail', 'pass']);
  assert.equal(verdict.checks[0].flaky, true);
  assert.equal(verdict.counts.requiredFlaky, 1);
  assert.equal(gateAction(verdict, 0, 2, 'enforce').action, 'allow');
  assert.match(formatFeedback(verdict), /flaky/i);
});

test('normalizePlan rejects invalid retries and records optional flaky checks', async () => {
  assert.equal(normalizePlan({ checks: [{ id: 'x', argv: ['node'], retries: -1 }] }).plan, null);
  const { plan } = normalizePlan({
    checks: [
      { id: 'required', argv: ['node', 'ok'] },
      { id: 'optional', argv: ['node', 'x'], required: false, retries: 1 },
    ],
  });
  let optionalCalls = 0;
  const verdict = await runPlan(plan, {
    cwd: process.cwd(),
    runCommand: async (check) => {
      if (check.id === 'optional') {
        optionalCalls += 1;
        return commandResult({ exitCode: optionalCalls === 1 ? 1 : 0 });
      }
      return commandResult({ exitCode: 0 });
    },
  });
  assert.equal(verdict.status, 'pass');
  assert.equal(verdict.counts.optionalFlaky, 1);
});

test('verdict reason, summary, title, and singular/plural text are stable', async () => {
  const onePass = normalizePlan({ id: 'one', title: 'One', checks: [{ id: 'good', argv: ['node', 'x'] }] }).plan;
  const pass = await runPlan(onePass, {
    cwd: process.cwd(),
    runCommand: async () => commandResult({ exitCode: 0 }),
  });
  assert.equal(pass.status, 'pass');
  assert.equal(pass.reason, 'all required checks passed');
  assert.equal(pass.summary, 'good:pass');
  assert.equal(pass.title, 'One');

  const oneFail = normalizePlan({ id: 'one', checks: [{ id: 'bad', argv: ['node', 'x'] }] }).plan;
  const fail = await runPlan(oneFail, {
    cwd: process.cwd(),
    runCommand: async () => commandResult({ exitCode: 1 }),
  });
  assert.equal(fail.reason, '1 required check failed');
  assert.equal(fail.summary, 'bad:fail');
  assert.equal(fail.title, undefined);
  assert.equal(Object.hasOwn(fail, 'title'), false);

  const twoFail = normalizePlan({
    checks: [{ id: 'a', argv: ['node', 'a'] }, { id: 'b', argv: ['node', 'b'] }],
  }).plan;
  const failedTwo = await runPlan(twoFail, {
    cwd: process.cwd(),
    runCommand: async () => commandResult({ exitCode: 1 }),
  });
  assert.equal(failedTwo.reason, '2 required checks failed');
  assert.equal(failedTwo.summary, 'a:fail b:fail');

  const unknown = await runPlan(oneFail, {
    cwd: process.cwd(),
    runCommand: async () => commandResult({ exitCode: null, timedOut: true }),
  });
  assert.equal(unknown.reason, '1 required check could not be verified');
  assert.equal(unknown.summary, 'bad:unknown');

  let calls = 0;
  const flakyPlan = normalizePlan({ checks: [{ id: 'flaky', argv: ['node', 'x'], retries: 1 }] }).plan;
  const flaky = await runPlan(flakyPlan, {
    cwd: process.cwd(),
    runCommand: async () => {
      calls += 1;
      return commandResult({ exitCode: calls === 1 ? 1 : 0 });
    },
  });
  assert.equal(flaky.reason, '1 required check is flaky');
  assert.equal(flaky.summary, 'flaky:flaky');

  const twoFlakyPlan = normalizePlan({
    checks: [
      { id: 'a', argv: ['node', 'a'], retries: 1 },
      { id: 'b', argv: ['node', 'b'], retries: 1 },
    ],
  }).plan;
  const callsByCheck = new Map();
  const twoFlaky = await runPlan(twoFlakyPlan, {
    cwd: process.cwd(),
    runCommand: async (check) => {
      const count = (callsByCheck.get(check.id) ?? 0) + 1;
      callsByCheck.set(check.id, count);
      return commandResult({ exitCode: count === 1 ? 1 : 0 });
    },
  });
  assert.equal(twoFlaky.reason, '2 required checks are flaky');
  assert.equal(twoFlaky.summary, 'a:flaky b:flaky');

  const twoUnknownPlan = normalizePlan({
    checks: [{ id: 'a', argv: ['node', 'a'] }, { id: 'b', argv: ['node', 'b'] }],
  }).plan;
  const twoUnknown = await runPlan(twoUnknownPlan, {
    cwd: process.cwd(),
    runCommand: async () => commandResult({ exitCode: null, timedOut: true }),
  });
  assert.equal(twoUnknown.reason, '2 required checks could not be verified');
  assert.equal(twoUnknown.summary, 'a:unknown b:unknown');
});

test('runPlan reports unknown for timeouts, spawn errors, and aborted turns', async () => {
  const { plan } = normalizePlan({ checks: [{ id: 'slow', argv: ['node', 'slow'] }] });
  const timedOut = await runPlan(plan, {
    cwd: process.cwd(),
    runCommand: async () => commandResult({ exitCode: null, timedOut: true }),
  });
  assert.equal(timedOut.status, 'unknown');

  const spawnError = await runPlan(plan, {
    cwd: process.cwd(),
    runCommand: async () => commandResult({ exitCode: null, error: { name: 'ENOENT', message: 'missing' } }),
  });
  assert.equal(spawnError.status, 'unknown');

  const controller = new AbortController();
  controller.abort();
  let called = false;
  const aborted = await runPlan(plan, {
    cwd: process.cwd(),
    signal: controller.signal,
    runCommand: async () => {
      called = true;
      return commandResult();
    },
  });
  assert.equal(aborted.status, 'unknown');
  assert.equal(called, false);
});

test('runPlan rejects check cwd escapes', async () => {
  const { plan } = normalizePlan({ checks: [{ id: 'escape', argv: ['node', 'x'], cwd: '../outside' }] });
  const verdict = await runPlan(plan, {
    cwd: process.cwd(),
    runCommand: async () => commandResult(),
  });
  assert.equal(verdict.status, 'unknown');
  assert.equal(verdict.checks[0].error.name, 'InvalidCwd');
});

test('gateAction follows the attempt ladder', () => {
  const fail = { status: 'fail' };
  const pass = { status: 'pass' };
  const unknown = { status: 'unknown' };
  assert.deepEqual(gateAction(pass, 3, 2), { action: 'allow', attempt: 3, reason: 'passed' });
  assert.deepEqual(gateAction(unknown, 0, 2), { action: 'allow', attempt: 0, reason: 'unknown' });
  assert.deepEqual(gateAction(fail, 0, 2), { action: 'steer', attempt: 1, reason: 'failed' });
  assert.deepEqual(gateAction(fail, 1, 2), { action: 'steer', attempt: 2, reason: 'failed' });
  assert.deepEqual(gateAction(fail, 2, 2), { action: 'steer-final', attempt: 3, reason: 'exhausted' });
  assert.deepEqual(gateAction(fail, 3, 2), { action: 'allow', attempt: 3, reason: 'exhausted' });
  assert.deepEqual(gateAction(fail, 0, 0), { action: 'allow', attempt: 0, reason: 'no-retry' });
  assert.deepEqual(gateAction(fail, 0, 2, 'dry-run'), { action: 'record', attempt: 0, reason: 'dry-run' });
});

test('feedback names the failing check and stays bounded', async () => {
  const { plan } = normalizePlan({ checks: [{ id: 'tests', argv: ['node', 'test.mjs'] }] });
  const verdict = await runPlan(plan, {
    cwd: process.cwd(),
    runCommand: async () => commandResult({ exitCode: 1, stdout: 'line one\nline two\nFAILED', stderr: 'boom' }),
  });
  const feedback = formatFeedback(verdict, { artifactPath: 'C:/tmp/latest.json', maxChars: 800 });
  assert.match(feedback, /Verification failed/);
  assert.match(feedback, /tests/);
  assert.match(feedback, /FAILED/);
  assert.match(feedback, /Evidence: C:\/tmp\/latest\.json/);
  assert.ok(feedback.length <= 800);
  const final = formatFinalFeedback(verdict, 2);
  assert.match(final, /2 feedback attempts/);
  assert.match(final, /do not claim success/i);
});

test('path containment helpers', () => {
  const root = path.resolve(os.tmpdir(), 'dsh-vk-root');
  assert.equal(isInside(root, path.join(root, 'a')), true);
  assert.equal(isInside(root, path.join(root, '..', 'outside')), false);
  assert.equal(resolveInside(root, 'a/b'), path.join(root, 'a', 'b'));
  assert.throws(() => resolveInside(root, '../outside'));
});

test('tailText keeps the tail and marks truncation', () => {
  assert.equal(tailText('abcdef', 3), '…[3 chars omitted]\ndef');
});

test('runCommand executes node argv, reports exit codes, and enforces timeouts', async () => {
  const ok = await runCommand({ argv: ['node', '-e', 'console.log("hello")'] }, { cwd: process.cwd(), timeoutMs: 10_000 });
  assert.equal(ok.exitCode, 0);
  assert.match(ok.stdout, /hello/);

  const failed = await runCommand({ argv: ['node', '-e', 'process.exit(3)'] }, { cwd: process.cwd(), timeoutMs: 10_000 });
  assert.equal(failed.exitCode, 3);

  const missing = await runCommand({ argv: ['definitely-not-a-real-binary-xyz'] }, { cwd: process.cwd(), timeoutMs: 10_000 });
  assert.equal(missing.exitCode, null);
  assert.notEqual(missing.error, null);

  const slow = await runCommand({ argv: ['node', '-e', 'setTimeout(() => {}, 5000)'] }, { cwd: process.cwd(), timeoutMs: 100 });
  assert.equal(slow.timedOut, true);
});

test('runPlan redacts secret-like evidence', async () => {
  assert.equal(redactSensitive('token=abc123'), 'token=[REDACTED]');
  const { plan } = normalizePlan({ checks: [{ id: 'secret', argv: ['node', 'x'] }] });
  const verdict = await runPlan(plan, {
    cwd: process.cwd(),
    runCommand: async () => commandResult({ stdout: 'api_key=super-secret\nAuthorization: Bearer abc.def', stderr: 'password: hunter2' }),
  });
  assert.doesNotMatch(verdict.checks[0].stdout, /super-secret|abc\.def/);
  assert.doesNotMatch(verdict.checks[0].stderr, /hunter2/);
  assert.match(verdict.checks[0].stdout, /\[REDACTED\]/);
});

test('writeVerdictArtifacts writes latest, history, trace, and hashes', async () => {
  const { writeVerdictArtifacts } = await import('../lib/artifacts.js');
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-vk-artifacts-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-vk-outside-'));
  const { plan } = normalizePlan({ checks: [{ id: 'a', argv: ['node', 'x'] }] });
  const verdict = await runPlan(plan, { cwd, runCommand: async () => commandResult({ stdout: 'evidence' }) });
  const artifacts = await writeVerdictArtifacts(cwd, verdict);
  assert.notEqual(artifacts, null);
  const latest = JSON.parse(await fs.readFile(artifacts.latest, 'utf8'));
  assert.equal(latest.status, 'pass');
  assert.ok(await fs.stat(artifacts.history));
  assert.match(await fs.readFile(artifacts.trace, 'utf8'), /"status":"pass"/);
  assert.match(latest.hashes.verdict, /^[a-f0-9]{64}$/);
  const withoutHashes = { ...latest };
  delete withoutHashes.hashes;
  assert.equal(hashValue(withoutHashes), latest.hashes.verdict);

  const external = await writeVerdictArtifacts(cwd, verdict, { dir: outside });
  assert.notEqual(external, null);
  assert.ok(external.latest.startsWith(outside));
  await fs.rm(cwd, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

test('normalizeCheck validates every field with exact diagnostics', () => {
  const errors = [];
  assert.equal(normalizeCheck(null, 0, errors), null);
  assert.deepEqual(errors, ['checks[0] must be an object']);

  const invalid = [];
  assert.equal(normalizeCheck({ argv: [], timeoutMs: 0, required: 'x', cwd: '', retries: 6 }, 0, invalid), null);
  assert.deepEqual(invalid, [
    'checks[0].argv must be a non-empty array of non-empty strings',
    'checks[0].timeoutMs must be a positive integer',
    'checks[0].required must be a boolean',
    'checks[0].cwd must be a non-empty string',
    'checks[0].retries must be an integer between 0 and 5',
  ]);

  const minimal = normalizeCheck({ argv: ['node'] }, 0);
  assert.equal(minimal.id, 'check-1');
  assert.equal(minimal.timeoutMs, 60_000);
  assert.equal(minimal.required, true);
  assert.equal(minimal.retries, 0);
  assert.equal(Object.hasOwn(minimal, 'cwd'), false);
  assert.equal(Object.hasOwn(minimal, 'title'), false);

  const explicit = normalizeCheck({ id: '  id  ', argv: ['node'], required: false, cwd: 'sub', retries: 2, title: 'T' }, 3);
  assert.deepEqual(explicit, { id: 'id', argv: ['node'], timeoutMs: 60_000, required: false, retries: 2, cwd: 'sub', title: 'T' });
  assert.equal(Object.hasOwn(normalizeCheck({ argv: ['node'], title: '' }, 0), 'title'), false);
});

test('normalizePlan validates shape, defaults, and title', () => {
  assert.deepEqual(normalizePlan(null).errors, ['plan must be an object']);
  assert.deepEqual(normalizePlan({ checks: 'nope' }).errors, ['plan.checks must be an array']);
  assert.deepEqual(normalizePlan({ checks: [] }).errors, ['plan has no checks']);

  const minimal = normalizePlan({ checks: [{ argv: ['node'] }] }).plan;
  assert.equal(minimal.id, 'verification');
  assert.equal(Object.hasOwn(minimal, 'title'), false);
  assert.equal(minimal.checks[0].id, 'check-1');

  const explicit = normalizePlan({ id: '  x  ', title: ' T ', checks: [{ id: 'a', argv: ['node'], title: 'C' }] }).plan;
  assert.equal(explicit.id, 'x');
  assert.equal(explicit.title, ' T ');
  assert.equal(explicit.checks[0].title, 'C');
  assert.equal(Object.hasOwn(normalizePlan({ id: '', title: '', checks: [{ argv: ['node'] }] }).plan, 'title'), false);
});

test('aborted checks and selectedCheckIds are explicit evidence', async () => {
  const { plan } = normalizePlan({ checks: [{ id: 'a', argv: ['node', 'a'] }, { id: 'b', argv: ['node', 'b'] }] });
  const controller = new AbortController();
  controller.abort();
  let called = 0;
  const aborted = await runPlan(plan, {
    cwd: process.cwd(),
    signal: controller.signal,
    runCommand: async () => { called += 1; return commandResult(); },
  });
  assert.equal(called, 0);
  const evidence = aborted.checks[0];
  assert.equal(evidence.id, 'a');
  assert.equal(evidence.required, true);
  assert.equal(evidence.status, 'unknown');
  assert.equal(evidence.exitCode, null);
  assert.equal(evidence.timedOut, false);
  assert.equal(evidence.durationMs, 0);
  assert.equal(evidence.stdout, '');
  assert.equal(evidence.stderr, '');
  assert.equal(evidence.cwd, '');
  assert.equal(evidence.error.name, 'AbortError');
  assert.equal(evidence.error.message, 'the turn was cancelled before the check ran');
  assert.equal(evidence.attempts, 1);
  assert.deepEqual(evidence.attemptStatuses, ['unknown']);
  assert.equal(evidence.retries, 0);

  const selected = normalizePlan({ checks: [{ id: 'a', argv: ['node', 'a'] }, { id: 'b', argv: ['node', 'b'] }] }).plan;
  const seen = [];
  const onlyB = await runPlan(selected, {
    cwd: process.cwd(),
    selectedCheckIds: ['b'],
    runCommand: async (check) => { seen.push(check.id); return commandResult(); },
  });
  assert.deepEqual(seen, ['b']);
  assert.equal(onlyB.status, 'pass');
  assert.deepEqual(onlyB.checks.map((check) => check.id), ['b']);
  assert.equal(onlyB.summary, 'b:pass');

  const none = await runPlan(selected, {
    cwd: process.cwd(),
    selectedCheckIds: ['missing'],
    runCommand: async () => commandResult(),
  });
  assert.equal(none.status, 'unknown');
  assert.equal(none.reason, 'no required checks were configured');
});

test('runPlan rejects a missing runner and an empty plan', async () => {
  await assert.rejects(() => runPlan({ checks: [] }, {}), TypeError);
  const empty = await runPlan(null, { cwd: process.cwd(), runCommand: async () => commandResult() });
  assert.equal(empty.status, 'unknown');
  assert.equal(empty.reason, 'no required checks were configured');
});

test('gateAction covers off, dry-run, flaky, and invalid numeric inputs', () => {
  const fail = { status: 'fail' };
  assert.deepEqual(gateAction(fail, 0, 2, 'off'), { action: 'allow', attempt: 0, reason: 'off' });
  assert.deepEqual(gateAction({ status: 'flaky' }, 0, 2), { action: 'allow', attempt: 0, reason: 'flaky' });
  assert.deepEqual(gateAction(fail, -5, 2), { action: 'steer', attempt: 1, reason: 'failed' });
  assert.deepEqual(gateAction(fail, 0, -1), { action: 'allow', attempt: 0, reason: 'no-retry' });
  assert.deepEqual(gateAction({ status: 'unknown' }, 99, 0), { action: 'allow', attempt: 99, reason: 'unknown' });
  assert.deepEqual(gateAction({ status: 'pass' }, -1, -1), { action: 'allow', attempt: 0, reason: 'passed' });
});

test('renderVerdict is a stable, compact contract', () => {
  const verdict = {
    status: 'fail',
    reason: 'bad',
    checks: [
      { id: 'x', status: 'fail', exitCode: 2, durationMs: 1234 },
      { id: 'y', status: 'pass', exitCode: 0, durationMs: 5 },
    ],
    artifactPath: 'C:/a.json',
  };
  assert.equal(renderVerdict(verdict), [
    'Verification: FAIL — bad',
    '- x: fail, exit 2 — 1.23s',
    '- y: pass, exit 0 — 0.01s',
    'Evidence: C:/a.json',
  ].join('\n'));
  assert.equal(renderVerdict({ ...verdict, artifactPath: '' }), [
    'Verification: FAIL — bad',
    '- x: fail, exit 2 — 1.23s',
    '- y: pass, exit 0 — 0.01s',
  ].join('\n'));
});

test('formatFeedback and formatFinalFeedback cover pass, unknown, flaky, errors, and artifacts', () => {
  const pass = { status: 'pass', reason: 'all required checks passed', checks: [] };
  assert.match(formatFeedback(pass), /^Verification passed\./);
  assert.doesNotMatch(formatFeedback(pass), /Do not claim/);

  const unknown = {
    status: 'unknown',
    reason: 'could not verify',
    checks: [{
      id: 'u', status: 'unknown', exitCode: null, durationMs: 10,
      error: { name: 'ENOENT', message: 'missing' }, attemptStatuses: ['fail', 'unknown'],
    }],
  };
  const unknownText = formatFeedback(unknown, { artifactPath: 'C:/u.json' });
  assert.match(unknownText, /could not be completed/);
  assert.match(unknownText, /attempts: fail -> unknown/);
  assert.match(unknownText, /error: ENOENT: missing/);
  assert.match(unknownText, /Evidence: C:\/u\.json/);
  assert.match(unknownText, /Do not claim verified success/);

  const flaky = {
    status: 'flaky',
    reason: '1 required check is flaky',
    checks: [{ id: 'f', status: 'flaky', exitCode: 0, durationMs: 5, error: null, attemptStatuses: ['fail', 'pass'] }],
  };
  const flakyText = formatFeedback(flaky);
  assert.match(flakyText, /could not be completed/);
  assert.match(flakyText, /flaky/);
  assert.match(flakyText, /Do not treat the pass-after-retry as proof/);

  const failed = {
    status: 'fail',
    reason: '1 required check failed',
    checks: [{ id: 'bad', status: 'fail', exitCode: 7, durationMs: 3, error: null }],
  };
  assert.match(formatFinalFeedback(failed, 1), /1 feedback attempt/);
  assert.match(formatFinalFeedback(failed, 2, { artifactPath: 'C:/f.json' }), /2 feedback attempts/);
  assert.match(formatFinalFeedback(failed, 2, { artifactPath: 'C:/f.json' }), /Evidence: C:\/f\.json/);
});

test('isInside rejects invalid inputs and handles the same path', () => {
  assert.equal(isInside('', '/a'), false);
  assert.equal(isInside('', 'a'), false);
  assert.equal(isInside('', ''), false);
  assert.equal(isInside('.', ''), false);
  assert.equal(isInside('', '.'), false);
  assert.equal(isInside('/a', ''), false);
  assert.equal(isInside('a', ''), false);
  assert.equal(isInside(null, '/a'), false);
  assert.equal(isInside(null, 'a'), false);
  assert.equal(isInside('/a', null), false);
  assert.equal(isInside('a', null), false);
  assert.equal(isInside(0, 0), false);
  const root = path.resolve(os.tmpdir(), 'dsh-vk-inside');
  assert.equal(isInside(root, ''), false);
  assert.equal(isInside(root, root), true);
  assert.equal(isInside('.', 'a'), true);
  if (process.platform === 'win32') assert.equal(isInside(root.toUpperCase(), root), true);
});

test('evidenceFromResult preserves optional fields and normalizes malformed results', async () => {
  const { plan } = normalizePlan({ checks: [{ id: 'x', argv: ['node'], required: false }] });
  const rich = await runPlan(plan, {
    cwd: process.cwd(),
    runCommand: async () => ({
      exitCode: 0,
      signal: 'SIGTERM',
      durationMs: 0,
      stdout: 'out',
      stderr: 'err',
      timedOut: false,
      error: null,
      spillPaths: ['a', 2, '', 'b'],
    }),
  });
  const evidence = rich.checks[0];
  assert.equal(evidence.status, 'pass');
  assert.equal(evidence.exitCode, 0);
  assert.equal(evidence.signal, 'SIGTERM');
  assert.equal(evidence.durationMs, 0);
  assert.equal(evidence.stdout, 'out');
  assert.equal(evidence.stderr, 'err');
  assert.deepEqual(evidence.spillPaths, ['a', '', 'b']);

  const malformed = await runPlan(plan, {
    cwd: process.cwd(),
    runCommand: async () => ({
      exitCode: 1.5,
      signal: 7,
      durationMs: -5,
      stdout: null,
      stderr: undefined,
      timedOut: true,
      error: { name: 9, message: { toString: () => 'stringified' } },
    }),
  });
  const bad = malformed.checks[0];
  assert.equal(bad.status, 'unknown');
  assert.equal(bad.exitCode, null);
  assert.equal(bad.signal, null);
  assert.equal(bad.timedOut, true);
  assert.equal(bad.durationMs, 0);
  assert.equal(bad.stdout, '');
  assert.equal(bad.stderr, '');
  assert.equal(bad.error.name, 'Error');
  assert.equal(bad.error.message, '[object Object]');

  const undefinedResult = await runPlan(plan, { cwd: process.cwd(), runCommand: async () => undefined });
  assert.equal(undefinedResult.status, 'unknown');
  assert.equal(undefinedResult.checks[0].exitCode, null);
  assert.equal(Object.hasOwn(undefinedResult.checks[0], 'spillPaths'), false);

  const stringExit = await runPlan(plan, { cwd: process.cwd(), runCommand: async () => ({ exitCode: '0' }) });
  assert.equal(stringExit.status, 'unknown');
  assert.equal(stringExit.checks[0].exitCode, null);
});

test('runPlan handles default cwd, selection edge cases, custom clock, and thrown errors', async () => {
  const { plan } = normalizePlan({
    checks: [{ id: 'a', argv: ['node', 'a'] }, { id: 'b', argv: ['node', 'b'] }],
  });
  const all = await runPlan(plan, {
    runCommand: async () => commandResult(),
    selectedCheckIds: [],
  });
  assert.equal(all.status, 'pass');
  assert.equal(all.cwd, process.cwd());
  assert.deepEqual(all.checks.map((check) => check.id), ['a', 'b']);

  let tick = 1000;
  const one = normalizePlan({ checks: [{ id: 'one', argv: ['node'] }] }).plan;
  const timed = await runPlan(one, {
    cwd: process.cwd(),
    now: () => { tick += 10; return tick; },
    runCommand: async () => commandResult({ durationMs: 1 }),
  });
  assert.ok(timed.finishedAt > timed.startedAt);
  assert.ok(timed.durationMs > 0);
  assert.equal(timed.checks[0].durationMs, 1);

  const thrown = await runPlan(plan, {
    cwd: process.cwd(),
    runCommand: async () => { throw new Error('boom'); },
  });
  assert.equal(thrown.status, 'unknown');
  assert.equal(thrown.checks[0].error.name, 'Error');
  assert.equal(thrown.checks[0].error.message, 'boom');
  assert.equal(thrown.checks[0].exitCode, null);
  assert.equal(thrown.checks[0].stdout, '');
  assert.equal(thrown.checks[0].stderr, '');

  const invalidCwd = normalizePlan({ checks: [{ id: 'escape', argv: ['node', 'x'], cwd: '../outside' }] }).plan;
  const escaped = await runPlan(invalidCwd, { cwd: process.cwd(), runCommand: async () => commandResult() });
  assert.equal(escaped.status, 'unknown');
  assert.equal(escaped.checks[0].status, 'unknown');
  assert.equal(escaped.checks[0].timedOut, false);
  assert.equal(escaped.checks[0].durationMs, 0);
  assert.equal(escaped.checks[0].stdout, '');
  assert.equal(escaped.checks[0].stderr, '');
  assert.equal(escaped.checks[0].cwd, '');
  assert.match(escaped.checks[0].error.message, /path escapes its base/);
});

test('formatting handles null exits, multiple checks, truncation, and empty artifacts', () => {
  assert.equal(renderVerdict({
    status: 'unknown',
    reason: 'n/a',
    checks: [{ id: 'x', status: 'unknown', exitCode: null, durationMs: 0 }],
    artifactPath: '',
  }), 'Verification: UNKNOWN — n/a\n- x: unknown — 0.00s');

  const verdict = {
    status: 'fail',
    reason: 'many',
    checks: [
      { id: 'a', status: 'fail', exitCode: null, durationMs: 0, error: null, stdout: 'l1\nl2', stderr: 'e1' },
      { id: 'b', status: 'fail', exitCode: 1, durationMs: 0, error: null },
      { id: 'c', status: 'fail', exitCode: 2, durationMs: 0, error: null },
      { id: 'd', status: 'fail', exitCode: 3, durationMs: 0, error: null },
      { id: 'ok', status: 'pass', exitCode: 0, durationMs: 0, error: null },
    ],
  };
  const text = formatFeedback(verdict, { maxChars: 2_000 });
  assert.match(text, /^Verification failed: many\./);
  assert.match(text, /- a: fail/);
  assert.match(text, /stdout tail:/);
  assert.match(text, /stderr tail:/);
  assert.doesNotMatch(text, /- d:/);
  assert.doesNotMatch(text, /- ok:/);
  assert.match(text, /Fix the failing checks/);
  assert.ok(text.length <= 2_000);

  const truncated = formatFeedback(verdict, { maxChars: 80 });
  assert.match(truncated, /…\[truncated\]$/);
  assert.doesNotMatch(formatFeedback({ status: 'pass', reason: 'ok', checks: [] }), /Evidence:/);
  assert.match(formatFeedback({ status: 'pass', reason: 'ok', checks: [] }, { artifactPath: 'C:/a' }), /Evidence: C:\/a/);

  assert.match(formatFinalFeedback(verdict, 1), /1 feedback attempt\./);
  assert.doesNotMatch(formatFinalFeedback(verdict, 1), /Evidence:/);
  assert.match(formatFinalFeedback(verdict, 2, { artifactPath: 'C:/f' }), /2 feedback attempts\./);
  assert.match(formatFinalFeedback(verdict, 2, { artifactPath: 'C:/f' }), /Evidence: C:\/f/);
});

test('tailText handles non-strings and the exact boundary', () => {
  assert.equal(tailText(null), '');
  assert.equal(tailText(undefined), '');
  assert.equal(tailText(123), '');
  assert.equal(tailText('abc', 3), 'abc');
  assert.equal(tailText('abcd', 3), '…[1 chars omitted]\nbcd');
  assert.equal(tailText('abcdef', 0), '…[6 chars omitted]\nabcdef');
});

test('normalizeCheck and normalizePlan boundaries are exact', () => {
  const boundaries = normalizeCheck({ id: '   ', argv: ['node'], required: false, cwd: 'sub', retries: 5, timeoutMs: 1 }, 0);
  assert.equal(boundaries.id, 'check-1');
  assert.deepEqual(boundaries.argv, ['node']);
  assert.equal(boundaries.required, false);
  assert.equal(boundaries.cwd, 'sub');
  assert.equal(boundaries.retries, 5);
  assert.equal(boundaries.timeoutMs, 1);

  for (const retries of [6, -1, 1.5]) {
    const errors = [];
    assert.equal(normalizeCheck({ argv: ['node'], retries }, 0, errors), null);
    assert.deepEqual(errors, ['checks[0].retries must be an integer between 0 and 5']);
  }
  for (const timeoutMs of [0, -1, 1.5]) {
    assert.equal(normalizeCheck({ argv: ['node'], timeoutMs }, 0), null);
  }
  assert.equal(normalizeCheck({ argv: ['node', 1] }, 0), null);
  assert.equal(normalizeCheck({ argv: ['node', ''] }, 0), null);
  assert.equal(normalizeCheck({ argv: ['node'], cwd: 1 }, 1), null);
  assert.equal(normalizeCheck([], 0), null);
  assert.equal(normalizeCheck('x', 0), null);

  assert.deepEqual(normalizePlan([]).errors, ['plan must be an object']);
  assert.deepEqual(normalizePlan('x').errors, ['plan must be an object']);
  assert.deepEqual(normalizePlan({ checks: null }).errors, ['plan.checks must be an array']);
  assert.deepEqual(normalizePlan({ checks: [{ id: 'x' }] }).errors, ['checks[0].argv must be a non-empty array of non-empty strings']);
  assert.equal(normalizePlan({ checks: [{ argv: ['node'] }] }).plan.id, 'verification');
  assert.equal(normalizePlan({ id: '  x  ', checks: [{ argv: ['node'] }] }).plan.id, 'x');
  assert.equal(normalizePlan({ title: 'T', checks: [{ argv: ['node'] }] }).plan.title, 'T');
  assert.equal(normalizePlan({ title: ' ', checks: [{ argv: ['node'] }] }).plan.title, ' ');
  assert.equal(Object.hasOwn(normalizePlan({ title: '', checks: [{ argv: ['node'] }] }).plan, 'title'), false);
});

test('hashing, tailText, and path containment edge contracts', () => {
  assert.match(hashValue('abc'), /^[a-f0-9]{64}$/);
  assert.equal(hashValue('abc'), hashValue('abc'));
  assert.notEqual(hashValue('abc'), hashValue({ value: 'abc' }));
  const withTitle = planHash({ id: 'x', title: 'T', checks: [] });
  const withoutTitle = planHash({ id: 'x', checks: [] });
  assert.notEqual(withTitle, withoutTitle);
  assert.match(planHash(undefined), /^[a-f0-9]{64}$/);
  assert.equal(planHash({ id: 'x', checks: 'nope' }), planHash({ id: 'x', checks: [] }));

  assert.equal(tailText('abc', 10), 'abc');
  assert.equal(tailText('abcd', 3), '…[1 chars omitted]\nbcd');
  assert.equal(tailText('abcdef', 0), '…[6 chars omitted]\nabcdef');
  assert.equal(tailText({}, 3), '');
  assert.equal(tailText(undefined, 3), '');

  const root = path.resolve(os.tmpdir(), 'dsh-vk-edge');
  assert.equal(resolveInside(root, ''), root);
  assert.equal(resolveInside(root, '.'), root);
  assert.equal(resolveInside(root, 'sub'), path.join(root, 'sub'));
  assert.throws(() => resolveInside(root, '..'), /path escapes its base/);
  assert.equal(isInside(root, path.join(root, 'sub', '..')), true);
  assert.equal(isInside(root, path.join(root, '..')), false);
  assert.equal(isInside('.', path.resolve('.')), true);
});

test('evidence status, cwd defaults, counts, and abort are complete', async () => {
  const { plan } = normalizePlan({ checks: [{ id: 'a', argv: ['node'] }] });
  const statusCases = [
    { result: { exitCode: 0, timedOut: true }, status: 'unknown' },
    { result: { exitCode: 0, error: { name: 'X', message: 'x' } }, status: 'unknown' },
    { result: { exitCode: null }, status: 'unknown' },
    { result: { exitCode: 0 }, status: 'pass' },
    { result: { exitCode: 1 }, status: 'fail' },
    { result: { exitCode: 0.5 }, status: 'unknown' },
  ];
  for (const item of statusCases) {
    const verdict = await runPlan(plan, { cwd: process.cwd(), runCommand: async () => item.result });
    assert.equal(verdict.status, item.status);
    assert.equal(verdict.checks[0].status, item.status);
  }

  const rich = await runPlan(plan, {
    cwd: process.cwd(),
    runCommand: async () => ({
      exitCode: 0,
      signal: 4,
      durationMs: undefined,
      stdout: 'out',
      stderr: 'err',
      timedOut: false,
      error: { name: 7, message: 7 },
      spillPaths: [],
    }),
  });
  assert.equal(rich.checks[0].signal, null);
  assert.equal(rich.checks[0].error.name, 'Error');
  assert.equal(rich.checks[0].error.message, '[object Object]');
  assert.equal(Object.hasOwn(rich.checks[0], 'spillPaths'), false);
  assert.ok(rich.checks[0].durationMs >= 0);

  const noCwd = await runPlan(plan, { runCommand: async () => commandResult() });
  assert.equal(noCwd.cwd, process.cwd());
  const emptyCwd = await runPlan(plan, { cwd: '', runCommand: async () => commandResult() });
  assert.equal(emptyCwd.cwd, process.cwd());
  const numericCwd = await runPlan(plan, { cwd: 123, runCommand: async () => commandResult() });
  assert.equal(numericCwd.cwd, process.cwd());

  const empty = await runPlan({ id: 'x', checks: [] }, { cwd: process.cwd(), runCommand: async () => commandResult() });
  assert.equal(empty.id, 'x');
  assert.equal(empty.reason, 'no required checks were configured');
  const missing = await runPlan({}, { cwd: process.cwd(), runCommand: async () => commandResult() });
  assert.equal(missing.id, 'verification');
  await assert.rejects(() => runPlan(plan, {}), /runPlan requires a runCommand function/);

  const mixed = normalizePlan({
    checks: [
      { id: 'req-pass', argv: ['node'] },
      { id: 'req-fail', argv: ['node'] },
      { id: 'opt-fail', argv: ['node'], required: false },
      { id: 'opt-flaky', argv: ['node'], required: false, retries: 1 },
    ],
  }).plan;
  const calls = new Map();
  const mixedVerdict = await runPlan(mixed, {
    cwd: process.cwd(),
    runCommand: async (check) => {
      if (check.id === 'req-fail') return commandResult({ exitCode: 1 });
      if (check.id === 'opt-fail') return commandResult({ exitCode: 1 });
      if (check.id === 'opt-flaky') {
        const n = (calls.get(check.id) ?? 0) + 1;
        calls.set(check.id, n);
        return commandResult({ exitCode: n === 1 ? 1 : 0 });
      }
      return commandResult();
    },
  });
  assert.equal(mixedVerdict.status, 'fail');
  assert.equal(mixedVerdict.counts.required, 2);
  assert.equal(mixedVerdict.counts.requiredPassed, 1);
  assert.equal(mixedVerdict.counts.requiredFailed, 1);
  assert.equal(mixedVerdict.counts.requiredFlaky, 0);
  assert.equal(mixedVerdict.counts.optional, 2);
  assert.equal(mixedVerdict.counts.optionalFailed, 1);
  assert.equal(mixedVerdict.counts.optionalFlaky, 1);
});

test('runPlan passes full command options and records every retry', async () => {
  const { plan } = normalizePlan({ checks: [{ id: 'retry', argv: ['node'], retries: 2 }] });
  const controller = new AbortController();
  const seen = [];
  const verdict = await runPlan(plan, {
    cwd: process.cwd(),
    signal: controller.signal,
    runCommand: async (check, options) => {
      seen.push(options);
      return commandResult({ exitCode: 1 });
    },
  });
  assert.equal(seen.length, 3);
  assert.equal(seen[0].cwd, process.cwd());
  assert.equal(seen[0].timeoutMs, 60_000);
  assert.equal(seen[0].signal, controller.signal);
  const evidence = verdict.checks[0];
  assert.equal(evidence.attempts, 3);
  assert.deepEqual(evidence.attemptStatuses, ['fail', 'fail', 'fail']);
  assert.equal(evidence.attemptDurations.length, 3);
  assert.equal(evidence.retries, 2);
  assert.equal(verdict.status, 'fail');
});

test('runPlan aborts between retries and normalizes thrown values', async () => {
  const { plan } = normalizePlan({ checks: [{ id: 'retry', argv: ['node'], retries: 2 }] });
  const controller = new AbortController();
  let calls = 0;
  const aborted = await runPlan(plan, {
    cwd: process.cwd(),
    signal: controller.signal,
    runCommand: async () => {
      calls += 1;
      controller.abort();
      return commandResult({ exitCode: 1 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(aborted.status, 'fail');
  assert.deepEqual(aborted.checks[0].attemptStatuses, ['fail', 'unknown']);
  assert.equal(aborted.checks[0].attempts, 2);
  assert.equal(aborted.checks[0].attemptDurations.length, 2);
  assert.equal(aborted.checks[0].error.name, 'AbortError');
  assert.equal(aborted.checks[0].error.message, 'the turn was cancelled before the check ran');

  const thrown = await runPlan(plan, {
    cwd: process.cwd(),
    runCommand: async () => { throw 'boom'; },
  });
  assert.equal(thrown.status, 'unknown');
  assert.equal(thrown.checks[0].error.name, 'Error');
  assert.equal(thrown.checks[0].error.message, 'boom');
  assert.equal(thrown.checks[0].timedOut, false);
  assert.equal(thrown.checks[0].exitCode, null);
  assert.ok(thrown.checks[0].durationMs < 1_000);

  const custom = await runPlan(plan, {
    cwd: process.cwd(),
    runCommand: async () => {
      const error = new Error('custom');
      error.name = 'CustomError';
      throw error;
    },
  });
  assert.equal(custom.checks[0].error.name, 'CustomError');
  assert.equal(custom.checks[0].error.message, 'custom');
  assert.ok(custom.checks[0].durationMs < 1_000);
});

test('retry accounting and flaky flags are exact', async () => {
  const { plan } = normalizePlan({ checks: [{ id: 'retry', argv: ['node'], retries: 2 }] });
  const passFirst = await runPlan(plan, { cwd: process.cwd(), runCommand: async () => commandResult() });
  assert.equal(passFirst.status, 'pass');
  assert.equal(passFirst.checks[0].status, 'pass');
  assert.equal(passFirst.checks[0].attempts, 1);
  assert.equal(passFirst.checks[0].attemptDurations.length, 1);
  assert.equal(Object.hasOwn(passFirst.checks[0], 'flaky'), false);

  let calls = 0;
  const flaky = await runPlan(plan, {
    cwd: process.cwd(),
    runCommand: async () => commandResult({ exitCode: (calls += 1) === 1 ? 1 : 0 }),
  });
  assert.equal(flaky.status, 'flaky');
  assert.equal(flaky.checks[0].attempts, 2);
  assert.equal(flaky.checks[0].attemptDurations.length, 2);
  assert.equal(flaky.checks[0].flaky, true);
});

test('feedback handles empty artifacts and exact final text', () => {
  const verdict = { status: 'fail', reason: 'x', checks: [] };
  assert.doesNotMatch(formatFeedback(verdict, { artifactPath: '' }), /Evidence:/);
  assert.doesNotMatch(formatFinalFeedback(verdict, 1, { artifactPath: '' }), /Evidence:/);
  assert.equal(formatFinalFeedback(verdict, 1), [
    'Verification is still failing after 1 feedback attempt.',
    'Latest verdict: fail — x.',
    'Stop retrying. Report the failure and the remaining failing checks honestly; do not claim success.',
  ].join('\n'));
  const long = formatFeedback(verdict, { maxChars: 10_000 });
  assert.equal(formatFeedback(verdict, { maxChars: long.length }), long);
});

test('normalizeCheck reports cwd errors and accepts retries=5', () => {
  const retryErrors = [];
  const retry = normalizeCheck({ argv: ['node'], retries: 5 }, 0, retryErrors);
  assert.equal(retry.retries, 5);
  assert.deepEqual(retryErrors, []);
  const cwdErrors = [];
  assert.equal(normalizeCheck({ argv: ['node'], cwd: 1 }, 0, cwdErrors), null);
  assert.deepEqual(cwdErrors, ['checks[0].cwd must be a non-empty string']);
  assert.equal(normalizeCheck(123, 0), null);
});

test('runPlan summary counts multiple passes and deterministic duration', async () => {
  const { plan } = normalizePlan({
    checks: [
      { id: 'a', argv: ['node'] },
      { id: 'b', argv: ['node'] },
      { id: 'c', argv: ['node'] },
    ],
  });
  let tick = 1000;
  const verdict = await runPlan(plan, {
    cwd: process.cwd(),
    now: () => { tick += 10; return tick; },
    runCommand: async (check) => commandResult({ exitCode: check.id === 'c' ? 1 : 0, durationMs: 1 }),
  });
  assert.equal(verdict.counts.requiredPassed, 2);
  assert.equal(verdict.counts.requiredFailed, 1);
  assert.equal(verdict.durationMs, 40);
  assert.equal(verdict.finishedAt - verdict.startedAt, 40);
});

test('hashValue hashes strings and non-strings with known digests', () => {
  assert.equal(hashValue('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(hashValue('123'), 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3');
  assert.equal(hashValue(123), hashValue('123'));
  assert.equal(hashValue({ a: 1 }), hashValue('{"a":1}'));
  assert.notEqual(hashValue(123), hashValue('{"value":123}'));
  assert.equal(planHash({ id: 'x', checks: [{ id: 'a', argv: ['node'] }] }), planHash({ id: 'x', checks: [{ id: 'a', argv: ['node'] }] }));
});

test('formatting filters passes, slices long tails, and clamps exactly', () => {
  const long = Array.from({ length: 15 }, (_, index) => `line-${index + 1}`).join('\n');
  const verdict = {
    status: 'fail',
    reason: 'many',
    checks: [
      { id: 'ok', status: 'pass', exitCode: 0, durationMs: 0, error: null },
      { id: 'one', status: 'fail', exitCode: 1, durationMs: 0, error: null, attemptStatuses: ['fail'], stdout: 'a\n\nb', stderr: '' },
      { id: 'two', status: 'fail', exitCode: 2, durationMs: 0, error: null, attemptStatuses: ['fail', 'fail'], stdout: long, stderr: '' },
    ],
  };
  const feedback = formatFeedback(verdict, { maxChars: 2_000 });
  assert.doesNotMatch(feedback, /- ok:/);
  assert.doesNotMatch(feedback, /- one:.*\n  attempts:/);
  assert.match(feedback, /- two:.*\n  attempts: fail -> fail/);
  assert.doesNotMatch(feedback, /line-1\n/);
  assert.match(feedback, /line-15/);
  assert.doesNotMatch(feedback, /\n  \| \n/);
  assert.doesNotMatch(feedback, /Evidence:/);

  const clamped = formatFeedback(verdict, { maxChars: 80 });
  assert.equal(clamped.length, 80 + '\n…[truncated]'.length);
  assert.match(clamped, /…\[truncated\]$/);
  assert.match(formatFinalFeedback(verdict, 2), /Latest verdict: fail — many\./);
});

test('gateAction covers zero-attempt and zero-cap boundaries', () => {
  const fail = { status: 'fail' };
  assert.deepEqual(gateAction(fail, 1, 0), { action: 'allow', attempt: 1, reason: 'no-retry' });
  assert.deepEqual(gateAction(fail, 0, 0), { action: 'allow', attempt: 0, reason: 'no-retry' });
  assert.deepEqual(gateAction({ status: 'pass' }, 0, 0), { action: 'allow', attempt: 0, reason: 'passed' });
  assert.deepEqual(gateAction(fail, 0, 2), { action: 'steer', attempt: 1, reason: 'failed' });
  assert.deepEqual(gateAction(fail, 2, 2), { action: 'steer-final', attempt: 3, reason: 'exhausted' });
  assert.deepEqual(gateAction(fail, 3, 2), { action: 'allow', attempt: 3, reason: 'exhausted' });
});

test('normalizePlan handles null checks and whitespace ids', () => {
  assert.deepEqual(normalizePlan({ checks: [null] }).errors, ['checks[0] must be an object']);
  assert.equal(normalizePlan({ id: '   ', checks: [{ argv: ['node'] }] }).plan.id, 'verification');
  assert.equal(normalizePlan({ id: ' x ', checks: [{ argv: ['node'] }] }).plan.id, 'x');
  assert.equal(normalizeCheck({ argv: ['node'], retries: 0 }, 0).retries, 0);
  assert.equal(normalizeCheck({ argv: ['node'], retries: 5 }, 0).retries, 5);
  assert.equal(normalizeCheck({ argv: ['node'] }, 0, []).id, 'check-1');
});

test('runPlan honors a custom cwd and duration fallback', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-cwd-'));
  const { plan } = normalizePlan({ checks: [{ id: 'cwd', argv: ['node'] }] });
  let seen = null;
  let tick = 0;
  const verdict = await runPlan(plan, {
    cwd: dir,
    now: () => { tick += 100; return tick; },
    runCommand: async (check, options) => {
      seen = options;
      return commandResult({ exitCode: 0, durationMs: undefined });
    },
  });
  assert.equal(verdict.cwd, dir);
  assert.equal(verdict.checks[0].cwd, dir);
  assert.equal(seen.cwd, dir);
  assert.equal(verdict.checks[0].durationMs, 100);
  await fs.rm(dir, { recursive: true, force: true });
});

test('runPlan normalizes null and undefined thrown values', async () => {
  const { plan } = normalizePlan({ checks: [{ id: 'x', argv: ['node'] }] });
  for (const thrown of [null, undefined]) {
    const verdict = await runPlan(plan, {
      cwd: process.cwd(),
      runCommand: async () => { throw thrown; },
    });
    assert.equal(verdict.status, 'unknown');
    assert.equal(verdict.checks[0].error.name, 'Error');
    assert.equal(verdict.checks[0].error.message, String(thrown));
  }
});

test('formatFeedback does not add flaky text for an unknown status', () => {
  const text = formatFeedback({
    status: 'weird',
    reason: 'x',
    checks: [{ id: 'x', status: 'fail', exitCode: 1, durationMs: 0, error: null }],
  });
  assert.doesNotMatch(text, /pass-after-retry/);
  assert.match(text, /Verification failed/);
});

test('formatFeedback preserves a non-truncated boundary', () => {
  const verdict = { status: 'fail', reason: 'x', checks: [] };
  const full = formatFeedback(verdict, { maxChars: 10_000 });
  const exact = formatFeedback(verdict, { maxChars: full.length });
  assert.equal(exact, full);
  assert.equal(exact.length, full.length);
  assert.doesNotMatch(exact, /\[truncated\]/);
  assert.equal(formatFeedback(verdict, { maxChars: full.length + 1 }), full);
});

test('evidenceFromResult maps every status directly', () => {
  const check = { id: 'x', required: true };
  const now = () => 100;
  const status = (result) => evidenceFromResult(check, result, '/tmp', now, 90).status;
  assert.equal(status({ exitCode: 0 }), 'pass');
  assert.equal(status({ exitCode: 1 }), 'fail');
  assert.equal(status({ exitCode: null }), 'unknown');
  assert.equal(status({ exitCode: 0, timedOut: true }), 'unknown');
  assert.equal(status({ exitCode: 0, error: { name: 'E', message: 'm' } }), 'unknown');
  assert.equal(status({ exitCode: '0' }), 'unknown');
});

test('clampText is exact at and beyond the boundary', () => {
  assert.equal(clampText('abc', 3), 'abc');
  assert.equal(clampText('abcd', 3), 'abc\n…[truncated]');
  assert.equal(clampText('abc', 4), 'abc');
  assert.match(clampText('abcdef', 2), /^ab\n…\[truncated\]$/);
});

test('feedback, render, and gate contracts cover fallbacks', () => {
  const verdict = {
    status: 'fail',
    reason: 'x',
    checks: [
      { id: 'zero', status: 'fail', exitCode: 0, durationMs: 0, error: null, stdout: '  ', stderr: '\n' },
      { id: 'null', status: 'fail', exitCode: null, durationMs: Number.NaN, error: null },
      { id: 'two', status: 'fail', exitCode: 2, durationMs: 1500, error: null, attemptStatuses: ['fail'] },
      { id: 'four', status: 'fail', exitCode: 4, durationMs: 5, error: null, attemptStatuses: ['fail', 'pass'] },
    ],
  };
  const feedback = formatFeedback(verdict, { maxChars: 0 });
  assert.match(feedback, /- zero: fail, exit 0, 0\.00s/);
  assert.match(feedback, /- null: fail\n/);
  assert.match(feedback, /- two: fail, exit 2, 1\.50s/);
  assert.doesNotMatch(feedback, /- four:/);
  assert.doesNotMatch(feedback, /stdout tail:/);
  assert.doesNotMatch(feedback, /stderr tail:/);
  assert.doesNotMatch(feedback, /Evidence:/);
  assert.match(formatFeedback(verdict, { maxChars: 1, artifactPath: 7 }), /truncated/);

  assert.match(renderVerdict({ status: 'pass', reason: 'ok', checks: [{ id: 'a', status: 'pass', exitCode: 0, durationMs: 0 }], artifactPath: 7 }), /a: pass, exit 0 — 0\.00s/);
  assert.doesNotMatch(renderVerdict({ status: 'pass', reason: 'ok', checks: [] }), /Evidence/);

  assert.deepEqual(gateAction(undefined, 0, 0), { action: 'allow', attempt: 0, reason: 'no-retry' });
  assert.deepEqual(gateAction(null, 1, 2), { action: 'steer', attempt: 2, reason: 'failed' });
  assert.deepEqual(gateAction({ status: 'pass' }, 0, 0, 'dry-run'), { action: 'record', attempt: 0, reason: 'dry-run' });
  assert.deepEqual(gateAction({ status: 'unknown' }, 0, 0, 'off'), { action: 'allow', attempt: 0, reason: 'off' });
  assert.deepEqual(gateAction({ status: 'fail' }, 0, -1), { action: 'allow', attempt: 0, reason: 'no-retry' });
  assert.deepEqual(gateAction({ status: 'fail' }, 0, 1.5), { action: 'allow', attempt: 0, reason: 'no-retry' });
  assert.deepEqual(gateAction({ status: 'fail' }, 0.5, 2), { action: 'steer', attempt: 1, reason: 'failed' });
  assert.deepEqual(gateAction({ status: 'fail' }, 0, 0.5), { action: 'allow', attempt: 0, reason: 'no-retry' });
});
