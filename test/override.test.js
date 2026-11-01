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
} from '../lib/override.js';

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
