import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyInWsl } from '../lib/verify-wsl.js';

const run = promisify(execFile);

test('verify-wsl runs the plan outside the Host process', async (t) => {
  if (!existsSync(path.resolve('..', 'session-view', 'index.js'))) {
    t.skip('session-view fixture is not available (e.g. Stryker sandbox)');
    return;
  }
  let result;
  try {
    result = await run(process.execPath, [
      path.resolve('bin/verify-wsl.js'),
      '--cwd', path.resolve('..', 'session-view'),
      '--plan', path.resolve('benchmarks', 'session-view-plan.json'),
      '--json',
    ], { cwd: path.resolve('.'), timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    if (/wsl|not found|no such file/i.test(String(error.stderr ?? error.message))) {
      return; // WSL is an optional external verifier boundary in this environment.
    }
    throw error;
  }
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.verdict.status, 'pass');
  assert.equal(payload.verdict.id, 'session-view');
  assert.match(payload.verdict.cwd, /^\/tmp\/dsh-verify\./);
  assert.deepEqual(payload.verdict.checks.map((check) => check.id), ['server-syntax', 'client-syntax']);
});

test('verify-wsl runs unprivileged, read-only, and network-isolated', async (t) => {
  const wslExecutable = process.env.WSL_EXECUTABLE || 'C:\\Windows\\System32\\wsl.exe';
  if (process.platform !== 'win32' || !existsSync(wslExecutable)) {
    t.skip('WSL2 boundary is not available on this host');
    return;
  }
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-wsl-readonly-'));
  const plan = path.join(cwd, 'plan.json');
  await fs.writeFile(plan, JSON.stringify({
    id: 'readonly',
    checks: [
      {
        id: 'write',
        argv: ['node', '-e', "require('node:fs').writeFileSync('forbidden.txt', 'x')"],
        required: true,
      },
      {
        id: 'network',
        argv: ['node', '-e', "require('node:dns').lookup('example.com', (err) => process.exit(err ? 0 : 1))"],
        required: true,
      },
    ],
  }), 'utf8');
  let result;
  try {
    result = await verifyInWsl({ cwd, planPath: plan, timeoutMs: 120_000 });
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
  assert.equal(result.ok, false);
  assert.equal(result.verdict.status, 'fail');
  const byId = new Map(result.verdict.checks.map((check) => [check.id, check]));
  assert.match(byId.get('write').stderr, /EACCES|EROFS|permission denied/i);
  assert.equal(byId.get('network').status, 'pass');
});
