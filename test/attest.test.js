import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ATTEST_RESULT, signBlob, verifyBlob } from '../lib/attest.js';

const run = promisify(execFile);
const attestBin = path.resolve('bin/attest.js');

function recordingRun(behaviour = {}) {
  const calls = [];
  const fn = async (bin, argv) => {
    calls.push({ bin, argv });
    if (behaviour.throw !== undefined) throw behaviour.throw;
    return { stdout: '', stderr: '' };
  };
  fn.calls = calls;
  return fn;
}

test('signBlob passes a bundle path and the artifact to cosign', async () => {
  const runner = recordingRun();
  const result = await signBlob('/tmp/verdict.json', { bundle: '/tmp/verdict.sigstore.json', run: runner });
  assert.equal(result.result, ATTEST_RESULT.OK);
  assert.deepEqual(runner.calls[0].argv, ['sign-blob', '--yes', '--bundle', '/tmp/verdict.sigstore.json', '/tmp/verdict.json']);
});

test('signBlob defaults the bundle beside the artifact', async () => {
  const runner = recordingRun();
  const result = await signBlob('/tmp/verdict.json', { run: runner });
  assert.equal(result.bundle, '/tmp/verdict.json.sigstore.json');
});

test('a missing cosign is unavailable, never success', async () => {
  const enoent = Object.assign(new Error('spawn cosign ENOENT'), { code: 'ENOENT' });
  const result = await signBlob('/tmp/verdict.json', { run: recordingRun({ throw: enoent }) });
  assert.equal(result.result, ATTEST_RESULT.UNAVAILABLE);
});

test('a refused signature is a failure with the reason attached', async () => {
  const denied = Object.assign(new Error('exit 1'), { code: 1, stderr: 'no identity token available' });
  const result = await signBlob('/tmp/verdict.json', { run: recordingRun({ throw: denied }) });
  assert.equal(result.result, ATTEST_RESULT.FAILED);
  assert.match(result.detail, /no identity token/);
});

test('verifyBlob pins the issuer and an optional identity regexp', async () => {
  const runner = recordingRun();
  await verifyBlob('/tmp/verdict.json', {
    bundle: '/tmp/b.json',
    identityRegexp: '^https://github.com/ff4554825-sys/verification-kernel/',
    run: runner,
  });
  const argv = runner.calls[0].argv;
  assert.deepEqual(argv.slice(0, 5), ['verify-blob', '--bundle', '/tmp/b.json', '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com']);
  assert.equal(argv[5], '--certificate-identity-regexp');
  assert.equal(argv[7], '/tmp/verdict.json');
});

test('verifyBlob works without an identity regexp', async () => {
  const runner = recordingRun();
  await verifyBlob('/tmp/verdict.json', { bundle: '/tmp/b.json', run: runner });
  assert.deepEqual(runner.calls[0].argv, [
    'verify-blob', '--bundle', '/tmp/b.json',
    '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com',
    '/tmp/verdict.json',
  ]);
});

test('the CLI exits 3 when cosign is absent', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-attest-'));
  try {
    const file = path.join(cwd, 'verdict.json');
    await fs.writeFile(file, '{}\n', 'utf8');
    await assert.rejects(
      run(process.execPath, [attestBin, 'sign', '--file', file, '--cosign', path.join(cwd, 'no-such-cosign')], { timeout: 30_000 }),
      (error) => error.code === 3 && /unavailable/.test(String(error.stderr)),
    );
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('the CLI signs through a stub cosign and reports ok', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-attest-stub-'));
  try {
    const file = path.join(cwd, 'verdict.json');
    await fs.writeFile(file, '{}\n', 'utf8');
    const stub = path.join(cwd, 'cosign');
    await fs.writeFile(stub, `#!/usr/bin/env bash\necho "$@" > "$(dirname "$0")/argv.txt"\nexit 0\n`, { mode: 0o755 });

    const { stdout } = await run(process.execPath, [attestBin, 'sign', '--file', file, '--cosign', stub, '--json'], { timeout: 30_000 });
    const payload = JSON.parse(stdout);
    assert.equal(payload.result, 'ok');
    assert.equal(payload.bundle, `${file}.sigstore.json`);
    const argv = await fs.readFile(path.join(cwd, 'argv.txt'), 'utf8');
    assert.match(argv, /^sign-blob --yes --bundle /);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
