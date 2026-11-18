import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  resolveKernelConfig,
  makeSubprocessRunner,
  toolValueFromVerdict,
  renderToolValue,
  resolveProjectForCwd,
  resolveProjectForCall,
} from '../lib/dsh.js';
import { createGate, hasGate } from '../index.js';
import { planHash } from '../lib/kernel.js';
import { generateSigningKeys, verifyVerdict } from '../lib/sign.js';

const check = { id: 'tests', argv: ['node', 'test.mjs'], required: true, timeoutMs: 1_000 };
const okResult = (overrides = {}) => ({
  exitCode: 0,
  signal: null,
  stdout: 'ok',
  stderr: '',
  durationMs: 4,
  timedOut: false,
  error: null,
  spillPaths: [],
  ...overrides,
});

test('resolveKernelConfig applies safe defaults and skips invalid checks', () => {
  const defaults = resolveKernelConfig({});
  assert.equal(defaults.mode, 'off');
  assert.equal(defaults.plan, null);
  assert.equal(defaults.maxAttempts, 2);
  assert.equal(defaults.writeArtifacts, true);
  assert.deepEqual(defaults.executables, {});
  assert.deepEqual(defaults.projects, []);
  assert.equal(defaults.autoLoad, false);

  const configured = resolveKernelConfig({
    mode: 'enforce',
    checks: [{ id: 'tests', argv: ['node', 'test.mjs'] }],
    maxAttempts: 1,
    executables: { node: 'C:/runtime/node.exe' },
  });
  assert.equal(configured.mode, 'enforce');
  assert.equal(configured.plan.checks[0].timeoutMs, 60_000);
  assert.equal(configured.maxAttempts, 1);
  assert.equal(configured.executables.node, 'C:/runtime/node.exe');

  const invalid = resolveKernelConfig({
    mode: 'loud',
    checks: [{ id: 'bad' }, { id: 'good', argv: ['node', 'x'] }, { id: 'good', argv: ['node', 'y'] }],
    maxAttempts: -1,
  });
  assert.equal(invalid.mode, 'off');
  assert.equal(invalid.plan.checks.length, 1);
  assert.equal(invalid.maxAttempts, 2);
  assert.ok(invalid.warnings.length >= 2);

  const isolated = resolveKernelConfig({
    isolation: 'wsl',
    wslDistro: 'Ubuntu-22.04',
    wslTimeoutMs: 60_000,
    projects: [{
      id: 'p',
      root: os.tmpdir(),
      checks: [{ id: 'c', argv: ['node', 'x'] }],
    }],
  });
  assert.equal(isolated.isolation, 'wsl');
  assert.equal(isolated.wslDistro, 'Ubuntu-22.04');
  assert.equal(isolated.wslTimeoutMs, 60_000);
  assert.equal(isolated.projects[0].isolation, 'wsl');
  const fallback = resolveKernelConfig({ isolation: 'docker', wslDistro: '', wslTimeoutMs: 0, outcomeStore: 7 });
  assert.equal(fallback.isolation, 'host');
  assert.equal(fallback.wslDistro, 'Ubuntu-22.04');
  assert.equal(fallback.wslTimeoutMs, 300_000);
  assert.equal(fallback.outcomeStore, undefined);
  assert.ok(fallback.warnings.length >= 4);
  assert.equal(resolveKernelConfig({ outcomeStore: '.dsh/outcomes.jsonl' }).outcomeStore, '.dsh/outcomes.jsonl');
  assert.equal(resolveKernelConfig({ signingKey: '.dsh/key.pem' }).signingKey, '.dsh/key.pem');
  assert.equal(resolveKernelConfig({ signingKey: 7 }).signingKey, undefined);
  const fast = resolveKernelConfig({
    gitPath: 'C:/git.exe',
    projects: [{
      id: 'fast',
      root: os.tmpdir(),
      checks: [{ id: 'syntax', argv: ['node', 'x'] }],
      fastPath: { maxFiles: 3, maxLines: 20, allowPaths: ['docs/'], checks: ['syntax'] },
    }],
  });
  assert.equal(fast.gitPath, 'C:/git.exe');
  assert.deepEqual(fast.projects[0].fastPath, {
    enabled: true,
    maxFiles: 3,
    maxLines: 20,
    allowPaths: ['docs/'],
    checks: ['syntax'],
  });
  assert.equal(fast.projects[0].gitPath, 'C:/git.exe');
  assert.equal(resolveKernelConfig({ projects: [{ root: os.tmpdir(), checks: [{ argv: ['node'] }], fastPath: { checks: [] } }] }).projects[0].fastPath, undefined);
});

test('makeSubprocessRunner uses the Host subprocess contract', async () => {
  let captured = null;
  const reader = (text) => ({ readFrom: () => ({ text, nextOffset: text.length, lossy: false }) });
  const fake = {
    resolveExecutable: async (command) => `resolved:${command}`,
    spawn: (spec) => {
      captured = spec;
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: { stdout: reader('hello'), stderr: reader('') },
        terminate() {},
      };
    },
  };
  const ctx = { get: (name) => (name === 'subprocess' ? fake : undefined) };
  const run = makeSubprocessRunner(ctx);
  const result = await run(check, { cwd: os.tmpdir(), timeoutMs: 5_000 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'hello');
  assert.equal(captured.argv[0], 'resolved:node');
  assert.deepEqual(captured.argv.slice(1), ['test.mjs']);
  assert.equal(captured.cwd, os.tmpdir());

  const mapped = makeSubprocessRunner(ctx, { node: 'C:/runtime/node.exe' });
  await mapped(check, { cwd: os.tmpdir(), timeoutMs: 5_000 });
  assert.equal(captured.argv[0], 'resolved:C:/runtime/node.exe');

  const missing = makeSubprocessRunner({ get: () => undefined });
  const missingResult = await missing(check, { cwd: os.tmpdir(), timeoutMs: 5_000 });
  assert.equal(missingResult.exitCode, null);
  assert.equal(missingResult.error.name, 'ServiceUnavailable');
});

test('tool value rendering keeps failure evidence compact', async () => {
  const { runPlan } = await import('../lib/kernel.js');
  const verdict = await runPlan({ id: 'x', checks: [check] }, {
    cwd: os.tmpdir(),
    runCommand: async () => okResult({ exitCode: 1, stdout: 'boom', stderr: 'trace' }),
  });
  const value = toolValueFromVerdict(verdict, 'C:/tmp/latest.json');
  assert.equal(value.status, 'fail');
  assert.match(value.checks[0].detail, /exit 1/);
  assert.match(value.checks[0].detail, /boom/);
  const rendered = renderToolValue(value);
  assert.match(rendered, /FAIL/);
  assert.match(rendered, /C:\/tmp\/latest\.json/);
});

function makeAgent(id = 'agent-1') {
  const handlers = new Map();
  const steers = [];
  const guards = [];
  const agent = {
    id,
    ctx: {
      effect: (callback) => callback(),
      on: (name, handler) => {
        handlers.set(name, handler);
        return () => handlers.delete(name);
      },
      tools: {
        guard: (guard) => {
          guards.push(guard);
          return () => {
            const index = guards.indexOf(guard);
            if (index >= 0) guards.splice(index, 1);
          };
        },
      },
    },
    steer: (message) => {
      steers.push(message);
    },
  };
  return { agent, handlers, steers, guards };
}

function makeCtx(cwd, origin = 'session') {
  return {
    sessions: { get: (id) => ({ id, header: { origin } }) },
    workingDirectory: { get: () => cwd, defaultDirectory: cwd },
  };
}

function makeConfig(overrides = {}) {
  return {
    mode: 'enforce',
    plan: { id: 'gate', checks: [check] },
    maxAttempts: 2,
    allowRoots: [],
    includeSubagents: false,
    writeArtifacts: false,
    artifactDir: '.dsh/verification',
    registerTool: false,
    toolTimeoutMs: 10_000,
    autoLoad: false,
    defaultMode: 'off',
    projects: [],
    overridePath: '.dsh/verification/override.json',
    denyTools: [],
    warnings: [],
    ...overrides,
  };
}

test('gate steers failing evidence, finalizes after the budget, then allows', async () => {
  const cwd = os.tmpdir();
  const ctx = makeCtx(cwd);
  const runner = async () => okResult({ exitCode: 1 });
  const gate = createGate(ctx, makeConfig(), runner);
  const { agent, handlers, steers } = makeAgent();
  gate.attach(agent);
  const stopping = handlers.get('agent/turn-stopping');
  assert.equal(typeof stopping, 'function');

  await stopping({ turn: 1, signal: new AbortController().signal });
  assert.equal(steers.length, 1);
  assert.match(steers[0].content[0].text, /Verification failed/);
  assert.equal(steers[0].source.kind, 'verification');
  assert.equal(steers[0].role, 'user');
  assert.equal(typeof steers[0].id, 'string');
  assert.ok(steers[0].id.length > 0);

  await stopping({ turn: 1, signal: new AbortController().signal });
  assert.equal(steers.length, 2);

  await stopping({ turn: 1, signal: new AbortController().signal });
  assert.equal(steers.length, 3);
  assert.match(steers[2].content[0].text, /still failing after 2/);
  assert.match(steers[2].content[0].text, /do not claim success/i);

  await stopping({ turn: 1, signal: new AbortController().signal });
  assert.equal(steers.length, 3);

  await stopping({ turn: 2, signal: new AbortController().signal });
  assert.equal(steers.length, 4);
});

test('gate does not steer on pass, dry-run, subagents, or disallowed roots', async () => {
  const cwd = os.tmpdir();
  const passing = createGate(makeCtx(cwd), makeConfig(), async () => okResult());
  const passAgent = makeAgent('pass');
  passing.attach(passAgent.agent);
  await passing.handle(passAgent.agent, { turn: 1, signal: new AbortController().signal });
  assert.equal(passAgent.steers.length, 0);

  const dry = createGate(makeCtx(cwd), makeConfig({ mode: 'dry-run' }), async () => okResult({ exitCode: 1 }));
  const dryAgent = makeAgent('dry');
  dry.attach(dryAgent.agent);
  await dry.handle(dryAgent.agent, { turn: 1, signal: new AbortController().signal });
  assert.equal(dryAgent.steers.length, 0);

  const subagent = createGate(makeCtx(cwd, 'subagent'), makeConfig(), async () => okResult({ exitCode: 1 }));
  const child = makeAgent('child');
  subagent.attach(child.agent);
  await subagent.handle(child.agent, { turn: 1, signal: new AbortController().signal });
  assert.equal(child.steers.length, 0);

  const outside = path.resolve(cwd, '..', 'not-allowed');
  const rooted = createGate(makeCtx(outside), makeConfig({ allowRoots: [cwd] }), async () => okResult({ exitCode: 1 }));
  const outsideAgent = makeAgent('outside');
  rooted.attach(outsideAgent.agent);
  await rooted.handle(outsideAgent.agent, { turn: 1, signal: new AbortController().signal });
  assert.equal(outsideAgent.steers.length, 0);
});

test('gate steers a retryable unknown and allows a non-retryable one', async () => {
  const cwd = os.tmpdir();

  // A timed-out check may pass if the agent makes it cheaper: steer once.
  const slow = createGate(makeCtx(cwd), makeConfig(), async () => okResult({ exitCode: null, timedOut: true }));
  const slowAgent = makeAgent('slow');
  slow.attach(slowAgent.agent);
  await slow.handle(slowAgent.agent, { turn: 1, signal: new AbortController().signal });
  assert.equal(slowAgent.steers.length, 1);
  const steerText = JSON.stringify(slowAgent.steers[0]);
  assert.match(steerText, /could not be completed/);
  assert.match(steerText, /timeout/);

  // A missing executable cannot be fixed by retrying: allow, keep unknown on record.
  const missing = createGate(makeCtx(cwd), makeConfig(), async () => okResult({
    exitCode: null,
    error: Object.assign(new Error('spawn node ENOENT'), { code: 'ENOENT' }),
  }));
  const missingAgent = makeAgent('missing');
  missing.attach(missingAgent.agent);
  await missing.handle(missingAgent.agent, { turn: 1, signal: new AbortController().signal });
  assert.equal(missingAgent.steers.length, 0);
});

test('gate ignores aborted turns and does not throw when check execution fails', async () => {
  const cwd = os.tmpdir();
  const abort = new AbortController();
  abort.abort();
  const aborted = createGate(makeCtx(cwd), makeConfig(), async () => okResult({ exitCode: 1 }));
  const abortedAgent = makeAgent('aborted');
  aborted.attach(abortedAgent.agent);
  await aborted.handle(abortedAgent.agent, { turn: 1, signal: abort.signal });
  assert.equal(abortedAgent.steers.length, 0);

  // A runner that throws is a spawn unknown: recorded, allowed, never leaked as
  // an exception. Retrying would not start the runner any better.
  const throwing = createGate(makeCtx(cwd), makeConfig(), async () => {
    throw new Error('runner exploded');
  });
  const throwAgent = makeAgent('throw');
  throwing.attach(throwAgent.agent);
  await throwing.handle(throwAgent.agent, { turn: 1, signal: new AbortController().signal });
  assert.equal(throwAgent.steers.length, 0);
});

test('gate honors a valid override and ignores an expired one', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-gate-override-'));
  const overrideFile = path.join(cwd, '.dsh', 'verification', 'override.json');
  await fs.mkdir(path.dirname(overrideFile), { recursive: true });
  const now = Date.now();
  await fs.writeFile(overrideFile, JSON.stringify({
    reason: 'known flake',
    project: '*',
    createdAt: now,
    expiresAt: now + 60_000,
  }), 'utf8');

  const gate = createGate(makeCtx(cwd), makeConfig({ allowRoots: [cwd] }), async () => okResult({ exitCode: 1 }));
  const agent = makeAgent('override-valid');
  gate.attach(agent.agent);
  await gate.handle(agent.agent, { turn: 1, signal: new AbortController().signal });
  assert.equal(agent.steers.length, 0);

  await fs.writeFile(overrideFile, JSON.stringify({
    reason: 'old',
    project: '*',
    createdAt: now - 120_000,
    expiresAt: now - 60_000,
  }), 'utf8');
  const expired = createGate(makeCtx(cwd), makeConfig({ allowRoots: [cwd] }), async () => okResult({ exitCode: 1 }));
  const expiredAgent = makeAgent('override-expired');
  expired.attach(expiredAgent.agent);
  await expired.handle(expiredAgent.agent, { turn: 1, signal: new AbortController().signal });
  assert.equal(expiredAgent.steers.length, 1);
  await fs.rm(cwd, { recursive: true, force: true });
});

test('gate registers a denyTools guard for the matching project', () => {
  const cwd = os.tmpdir();
  const config = resolveKernelConfig({
    mode: 'enforce',
    projects: [{
      id: 'guarded',
      root: cwd,
      checks: [{ id: 'x', argv: ['node', 'x'] }],
      denyTools: ['plugin_manager'],
    }],
  });
  const gate = createGate(makeCtx(cwd), config, async () => okResult());
  const { agent, guards } = makeAgent('guarded-agent');
  gate.attach(agent);
  assert.equal(guards.length, 1);
  assert.match(guards[0]({ name: 'plugin_manager' }), /denied by verification policy/);
  assert.equal(guards[0]({ name: 'read' }), undefined);
  gate.detach('guarded-agent');
  assert.equal(guards.length, 0);
});

test('gate refuses to run a plan whose pinned hash does not match', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-gate-hash-'));
  const config = resolveKernelConfig({
    mode: 'enforce',
    projects: [{
      id: 'pinned',
      root: cwd,
      checks: [{ id: 'x', argv: ['node', 'x'] }],
      expectedPlanHash: '0'.repeat(64),
    }],
  });
  assert.notEqual(planHash(config.projects[0].plan), '0'.repeat(64));
  let called = false;
  const gate = createGate(makeCtx(cwd), config, async () => {
    called = true;
    return okResult({ exitCode: 1 });
  });
  const agent = makeAgent('pinned-hash');
  gate.attach(agent.agent);
  await gate.handle(agent.agent, { turn: 1, signal: new AbortController().signal });
  assert.equal(called, false);
  assert.equal(agent.steers.length, 0);
  await fs.rm(cwd, { recursive: true, force: true });
});

test('project router selects the longest root and the single-project fallback', () => {
  const rootA = path.resolve(os.tmpdir(), 'router-a');
  const rootB = path.join(rootA, 'nested');
  const config = resolveKernelConfig({
    mode: 'dry-run',
    projects: [
      { id: 'a', root: rootA, checks: [{ id: 'a-check', argv: ['node', 'a'] }] },
      { id: 'b', root: rootB, checks: [{ id: 'b-check', argv: ['node', 'b'] }], mode: 'enforce' },
    ],
  });
  assert.equal(config.projects.length, 2);
  assert.equal(resolveProjectForCwd(config, path.join(rootA, 'x')).id, 'a');
  assert.equal(resolveProjectForCwd(config, path.join(rootB, 'x')).id, 'b');
  assert.equal(resolveProjectForCwd(config, path.resolve(rootA, '..', 'other')), null);
  assert.equal(resolveProjectForCall(config, path.join(rootA, 'x'), 'b').id, 'b');
  assert.equal(hasGate(config), true);

  const single = resolveKernelConfig({
    mode: 'dry-run',
    projects: [{ id: 'only', root: rootA, checks: [{ id: 'x', argv: ['node', 'x'] }] }],
  });
  assert.equal(resolveProjectForCall(single, path.resolve(rootA, '..', 'other')).id, 'only');
});

test('gate runs a wsl project without the Host runner', async (t) => {
  const root = path.resolve('..', 'session-view');
  if (!existsSync(path.join(root, 'index.js'))) {
    t.skip('session-view fixture is not available (e.g. Stryker sandbox)');
    return;
  }
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-wsl-gate-'));
  const keys = generateSigningKeys();
  const privateKeyPath = path.join(out, 'verification.key');
  const publicKeyPath = path.join(out, 'verification.pub');
  await fs.writeFile(privateKeyPath, keys.privateKey, 'utf8');
  await fs.writeFile(publicKeyPath, keys.publicKey, 'utf8');
  const config = makeConfig({
    plan: null,
    projects: [{
      id: 'session-view',
      root,
      plan: {
        id: 'session-view',
        checks: [{ id: 'server', argv: ['node', '--check', 'index.js'], required: true, timeoutMs: 30_000 }],
      },
      mode: 'enforce',
      maxAttempts: 0,
      includeSubagents: false,
      writeArtifacts: true,
      artifactDir: out,
      overridePath: path.join(out, 'override.json'),
      denyTools: [],
      executables: {},
      isolation: 'wsl',
      wslDistro: 'Ubuntu-22.04',
      wslTimeoutMs: 120_000,
      outcomeStore: path.join(out, 'outcomes.jsonl'),
      signingKey: privateKeyPath,
    }],
    writeArtifacts: true,
    artifactDir: out,
  });
  let injected = false;
  const gate = createGate(makeCtx(root), config, async () => {
    injected = true;
    return okResult();
  });
  const { agent, steers } = makeAgent('wsl-gate');
  gate.attach(agent);
  await gate.handle(agent, { turn: 1, signal: new AbortController().signal });
  assert.equal(injected, false);
  assert.equal(steers.length, 0);
  const latest = JSON.parse(await fs.readFile(path.join(out, 'latest.json'), 'utf8'));
  assert.equal(latest.status, 'pass');
  assert.equal(latest.isolation, 'wsl');
  assert.equal(latest.remote.distro, 'Ubuntu-22.04');
  assert.equal(verifyVerdict(latest, keys.publicKey), true);
  assert.equal(latest.signature.alg, 'ed25519');
  const outcomes = await fs.readFile(path.join(out, 'outcomes.jsonl'), 'utf8');
  const record = JSON.parse(outcomes.trim().split(/\r?\n/).at(-1));
  assert.equal(record.project, 'session-view');
  assert.equal(record.status, 'pass');
  assert.equal(record.isolation, 'wsl');
  assert.ok(record.durationMs >= 0);
  await fs.rm(out, { recursive: true, force: true });
});

test('gate uses the snapshot fast path after a docs-only change', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-fast-gate-'));
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs', 'guide.md'), '# base\n', 'utf8');
  await fs.writeFile(path.join(root, 'index.js'), 'export const x = 1;\n', 'utf8');
  const config = makeConfig({
    plan: null,
    gitPath: 'definitely-not-git',
    projects: [{
      id: 'fast',
      root,
      plan: {
        id: 'fast',
        checks: [
          { id: 'syntax', argv: ['node', 'x'], required: true },
          { id: 'unit', argv: ['node', 'y'], required: true },
        ],
      },
      mode: 'enforce',
      maxAttempts: 0,
      includeSubagents: false,
      writeArtifacts: false,
      artifactDir: path.join(root, '.dsh', 'verification'),
      overridePath: path.join(root, '.dsh', 'verification', 'override.json'),
      denyTools: [],
      executables: {},
      fastPath: { enabled: true, maxFiles: 3, maxLines: 20, allowPaths: ['docs/'], checks: ['syntax'] },
    }],
    writeArtifacts: false,
  });
  const calls = [];
  const gate = createGate(makeCtx(root), config, async (check) => {
    calls.push(check.id);
    return okResult();
  });
  const { agent } = makeAgent('fast-gate');
  gate.attach(agent);
  await gate.handle(agent, { turn: 1, signal: new AbortController().signal });
  assert.deepEqual(calls, ['syntax', 'unit']); // first turn establishes snapshot, full plan
  await fs.writeFile(path.join(root, 'docs', 'guide.md'), '# updated\n', 'utf8');
  calls.length = 0;
  await gate.handle(agent, { turn: 2, signal: new AbortController().signal });
  assert.deepEqual(calls, ['syntax']); // docs-only fast path
  await fs.rm(root, { recursive: true, force: true });
});
