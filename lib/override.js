/** File-based human override records for the verification gate. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { canonicalJson, publicKeyId } from './sign.js';

export const DEFAULT_OVERRIDE_PATH = '.dsh/verification/override.json';
const DEFAULT_TTL_MS = 60 * 60 * 1000;

function toEpoch(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Everything a signature covers: the record minus the signature itself. */
function signedFields(record) {
  const { signature: _signature, ...body } = record;
  return body;
}

/** Sign an override so it cannot be forged by the agent that the gate governs. */
export function signOverride(record, privateKeyPem) {
  if (record === null || typeof record !== 'object') throw new Error('override record is required');
  const key = createPrivateKey(privateKeyPem);
  const body = signedFields(record);
  return {
    ...body,
    signature: {
      alg: 'ed25519',
      keyId: publicKeyId(createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString()),
      value: sign(null, Buffer.from(canonicalJson(body)), key).toString('base64'),
      signedAt: Date.now(),
    },
  };
}

/** Verify a signed override; false on missing, tampered, or foreign signatures. */
export function verifyOverrideSignature(record, publicKeyPem) {
  if (record === null || typeof record !== 'object') return false;
  const signature = record.signature;
  if (signature === null || typeof signature !== 'object') return false;
  if (signature.alg !== 'ed25519' || typeof signature.value !== 'string') return false;
  try {
    if (signature.keyId !== publicKeyId(publicKeyPem)) return false;
    return verify(null, Buffer.from(canonicalJson(signedFields(record))), createPublicKey(publicKeyPem), Buffer.from(signature.value, 'base64'));
  } catch {
    return false;
  }
}

/** Validate an override record; returns null for unusable records. */
export function normalizeOverride(raw, now = Date.now()) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  if (reason === '') return null;
  const createdAt = toEpoch(raw.createdAt) ?? now;
  const expiresAt = toEpoch(raw.expiresAt) ?? createdAt + DEFAULT_TTL_MS;
  if (expiresAt <= createdAt) return null;
  const project = typeof raw.project === 'string' && raw.project.trim() !== '' ? raw.project.trim() : '*';
  const record = { reason, project, createdAt, expiresAt };
  if (typeof raw.planHash === 'string' && raw.planHash !== '') record.planHash = raw.planHash;
  if (typeof raw.verdictHash === 'string' && raw.verdictHash !== '') record.verdictHash = raw.verdictHash;
  const signature = raw.signature;
  if (signature !== null && typeof signature === 'object' && !Array.isArray(signature)) {
    if (signature.alg === 'ed25519' && typeof signature.value === 'string' && typeof signature.keyId === 'string') {
      record.signature = { alg: 'ed25519', keyId: signature.keyId, value: signature.value, signedAt: toEpoch(signature.signedAt) ?? createdAt };
    }
  }
  return record;
}

export function overrideMatches(override, { projectId = '', planHash = '', verdictHash = '' } = {}) {
  if (override === null || typeof override !== 'object') return false;
  if (override.project !== '*' && override.project !== projectId) return false;
  if (override.planHash !== undefined && override.planHash !== planHash) return false;
  if (override.verdictHash !== undefined && override.verdictHash !== verdictHash) return false;
  return true;
}

export function resolveOverridePath(base, configuredPath) {
  const value = typeof configuredPath === 'string' && configuredPath !== '' ? configuredPath : DEFAULT_OVERRIDE_PATH;
  return path.resolve(base, value);
}

/**
 * Read an unexpired override.
 * @param filePath - override file.
 * @param now - clock.
 * @param options - `{ publicKeyPem }`: when set, an unsigned or invalidly signed
 *   override reads as null, so an agent with workspace write access cannot
 *   grant itself one.
 */
export async function readOverride(filePath, now = Date.now(), options = {}) {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const override = normalizeOverride(raw, now);
  if (override === null || override.expiresAt <= now) return null;
  if (typeof options.publicKeyPem === 'string' && options.publicKeyPem !== '') {
    if (!verifyOverrideSignature(override, options.publicKeyPem)) return null;
  }
  return override;
}

export async function writeOverride(filePath, raw, now = Date.now()) {
  const override = normalizeOverride(raw, now);
  if (override === null) throw new Error('override requires a non-empty reason and a positive lifetime');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(override, null, 2)}\n`, 'utf8');
  return { path: filePath, override };
}

export async function revokeOverride(filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
