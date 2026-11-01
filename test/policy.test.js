import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const OPA = process.env.OPA_EXECUTABLE || path.resolve('tools', 'bin', 'opa.exe');
const POLICY = path.resolve('policies');

async function decide(input) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-policy-'));
  const file = path.join(dir, 'input.json');
  await fs.writeFile(file, JSON.stringify(input), 'utf8');
  try {
    const { stdout } = await run(OPA, ['eval', '--format', 'json', '--data', POLICY, '--input', file, 'data.verification.decision'], { timeout: 20_000 });
    return JSON.parse(stdout)?.result?.[0]?.expressions?.[0]?.value;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function opaAvailable() {
  try {
    await run(OPA, ['version'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

test('OPA policy allows pass and denies fail without override', async (t) => {
  if (!(await opaAvailable())) {
    t.skip('OPA is not available');
    return;
  }
  const pass = await decide({ status: 'pass' });
  assert.equal(pass.allow, true);
  const fail = await decide({ status: 'fail' });
  assert.equal(fail.allow, false);
  assert.ok(fail.violations.length > 0);
  const override = await decide({ status: 'fail', override: { reason: 'known flake' } });
  assert.equal(override.allow, true);
  const flaky = await decide({ status: 'flaky' });
  assert.equal(flaky.allow, false);
});
