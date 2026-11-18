import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalJson, generateSigningKeys, publicKeyId, signVerdict, verifyVerdict } from '../lib/sign.js';

const run = promisify(execFile);

test('ed25519 signing is deterministic and tamper-evident', async () => {
  const keys = generateSigningKeys();
  assert.match(keys.privateKey, /BEGIN PRIVATE KEY/);
  assert.match(keys.publicKey, /BEGIN PUBLIC KEY/);
  assert.match(publicKeyId(keys.publicKey), /^[a-f0-9]{16}$/);
  assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), '{"a":[{"c":3,"d":2}],"b":1}');

  const signed = signVerdict({ id: 'demo', status: 'pass', checks: [] }, keys.privateKey);
  assert.equal(signed.signature.alg, 'ed25519');
  assert.equal(verifyVerdict(signed, keys.publicKey), true);
  assert.equal(verifyVerdict({ ...signed, status: 'fail' }, keys.publicKey), false);
  assert.equal(verifyVerdict({ ...signed, signature: { ...signed.signature, keyId: 'x' } }, keys.publicKey), false);
  assert.equal(verifyVerdict({ id: 'demo', status: 'pass' }, keys.publicKey), false);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-sign-'));
  const keygen = await run(process.execPath, [path.resolve('bin/verification-keygen.js'), '--out-dir', dir, '--json']);
  const info = JSON.parse(keygen.stdout);
  const artifact = path.join(dir, 'verdict.json');
  const cliSigned = signVerdict({ id: 'demo', status: 'pass' }, await fs.readFile(info.privateKey, 'utf8'));
  await fs.writeFile(artifact, JSON.stringify(cliSigned), 'utf8');
  const verified = await run(process.execPath, [path.resolve('bin/verdict-verify.js'), '--verdict', artifact, '--pub', info.publicKey, '--json']);
  assert.equal(JSON.parse(verified.stdout).valid, true);
  await fs.writeFile(artifact, JSON.stringify({ ...cliSigned, status: 'fail' }), 'utf8');
  await assert.rejects(run(process.execPath, [path.resolve('bin/verdict-verify.js'), '--verdict', artifact, '--pub', info.publicKey]));
  await fs.rm(dir, { recursive: true, force: true });
});

test('dsh-verify can produce a signed artifact for CI', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-sign-cli-'));
  const keys = generateSigningKeys();
  const privateKey = path.join(dir, 'verification.key');
  await fs.writeFile(privateKey, keys.privateKey, 'utf8');
  await fs.writeFile(path.join(dir, 'plan.json'), JSON.stringify({
    id: 'signed',
    checks: [{ id: 'ok', argv: [process.execPath, '-e', 'process.exit(0)'], required: true }],
  }), 'utf8');
  const result = await run(process.execPath, [
    path.resolve('bin/verify.js'),
    '--plan', 'plan.json',
    '--cwd', dir,
    '--sign-key', privateKey,
    '--json',
  ]);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.verdict.status, 'pass');
  assert.equal(verifyVerdict(payload.verdict, keys.publicKey), true);
  const latest = JSON.parse(await fs.readFile(path.join(dir, '.dsh', 'verification', 'latest.json'), 'utf8'));
  assert.equal(verifyVerdict(latest, keys.publicKey), true);
  await fs.rm(dir, { recursive: true, force: true });
});
