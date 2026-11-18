import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeOverride,
  overrideMatches,
  readOverride,
  writeOverride,
  revokeOverride,
  signOverride,
  verifyOverrideSignature,
} from '../lib/override.js';
import { generateSigningKeys } from '../lib/sign.js';

test('normalizeOverride requires a reason and a positive lifetime', () => {
  const now = 1_700_000_000_000;
  const valid = normalizeOverride({ reason: 'known flake', project: 'demo' }, now);
  assert.equal(valid.project, 'demo');
  assert.equal(valid.expiresAt, now + 60 * 60 * 1000);
  assert.equal(normalizeOverride({ reason: '   ' }, now), null);
  assert.equal(normalizeOverride({ reason: 'x', createdAt: now, expiresAt: now }, now), null);
  assert.equal(normalizeOverride({ reason: 'x', createdAt: now, expiresAt: now - 1 }, now), null);
});

test('overrideMatches respects project and plan hash constraints', () => {
  const override = normalizeOverride({
    reason: 'approved',
    project: 'demo',
    planHash: 'abc',
    expiresAt: Date.now() + 60_000,
  });
  assert.equal(overrideMatches(override, { projectId: 'demo', planHash: 'abc' }), true);
  assert.equal(overrideMatches(override, { projectId: 'other', planHash: 'abc' }), false);
  assert.equal(overrideMatches(override, { projectId: 'demo', planHash: 'def' }), false);
  assert.equal(overrideMatches({ ...override, project: '*' }, { projectId: 'other', planHash: 'abc' }), true);
});

test('readOverride ignores missing, malformed, and expired files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-override-'));
  const file = path.join(dir, 'override.json');
  assert.equal(await readOverride(file), null);
  await fs.writeFile(file, '{not json', 'utf8');
  assert.equal(await readOverride(file), null);
  await fs.writeFile(file, JSON.stringify({ reason: 'old', expiresAt: Date.now() - 1 }), 'utf8');
  assert.equal(await readOverride(file), null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('writeOverride writes a readable record and revoke removes it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-override-'));
  const file = path.join(dir, 'nested', 'override.json');
  const now = Date.now();
  const written = await writeOverride(file, {
    reason: 'approved',
    project: 'demo',
    createdAt: now,
    expiresAt: now + 60_000,
  }, now);
  assert.equal(written.path, file);
  const read = await readOverride(file, now);
  assert.equal(read.reason, 'approved');
  assert.equal(read.project, 'demo');
  assert.equal(await revokeOverride(file), true);
  assert.equal(await revokeOverride(file), false);
  await fs.rm(dir, { recursive: true, force: true });
});

test('a signed override verifies and a tampered one does not', () => {
  const { privateKey, publicKey } = generateSigningKeys();
  const record = { reason: 'known flake', project: '*', createdAt: 1, expiresAt: 2 };
  const signed = signOverride(record, privateKey);
  assert.equal(signed.signature.alg, 'ed25519');
  assert.equal(verifyOverrideSignature(signed, publicKey), true);

  assert.equal(verifyOverrideSignature({ ...signed, reason: 'ship it' }, publicKey), false);
  assert.equal(verifyOverrideSignature({ ...signed, expiresAt: 999 }, publicKey), false);
  assert.equal(verifyOverrideSignature(record, publicKey), false);
});

test('a signature from another key is refused', () => {
  const mine = generateSigningKeys();
  const other = generateSigningKeys();
  const signed = signOverride({ reason: 'ok', project: '*', createdAt: 1, expiresAt: 2 }, mine.privateKey);
  assert.equal(verifyOverrideSignature(signed, other.publicKey), false);
});

test('readOverride enforces the signature only when a public key is configured', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-override-sig-'));
  try {
    const { privateKey, publicKey } = generateSigningKeys();
    const file = path.join(cwd, 'override.json');
    const unsigned = await writeOverride(file, { reason: 'no key configured', project: '*', minutes: 5 });
    const now = Date.now();

    // No public key: an unsigned file is still honoured (existing setups keep working).
    assert.notEqual(await readOverride(file, now), null);

    // Public key configured: the unsigned file is not an override at all.
    assert.equal(await readOverride(file, now, { publicKeyPem: publicKey }), null);

    // Signed: accepted by the same key, refused by another.
    const signedPath = path.join(cwd, 'signed.json');
    await fs.writeFile(signedPath, JSON.stringify(signOverride(unsigned.override, privateKey)), 'utf8');
    assert.notEqual(await readOverride(signedPath, now, { publicKeyPem: publicKey }), null);
    assert.equal(await readOverride(signedPath, now, { publicKeyPem: generateSigningKeys().publicKey }), null);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('signing an override is not a security boundary on its own', async () => {
  // The private key lives wherever the human put it. This test documents the
  // limit: signing raises the bar from "write a file" to "hold the key", it does
  // not make an in-workspace override tamper-proof.
  const { privateKey, publicKey } = generateSigningKeys();
  const signed = signOverride({ reason: 'documented limit', project: '*', createdAt: 1, expiresAt: 2 }, privateKey);
  assert.equal(verifyOverrideSignature(signed, publicKey), true);
});
