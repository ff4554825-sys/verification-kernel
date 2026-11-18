/** Ed25519 signatures for verification verdicts (tamper evidence, not remote attestation). */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

/** Deterministic JSON: sorted object keys recursively. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function generateSigningKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export function publicKeyId(publicKeyPem) {
  const key = createPublicKey(publicKeyPem);
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
}

/** Sign a verdict body (signature field excluded). */
function signedBody(verdict) {
  const { signature: _signature, artifacts: _artifacts, hashes: _hashes, artifactPath: _artifactPath, ...body } = verdict;
  return body;
}

export function signVerdict(verdict, privateKeyPem) {
  if (verdict === null || typeof verdict !== 'object') throw new Error('verdict is required');
  const body = signedBody(verdict);
  const key = createPrivateKey(privateKeyPem);
  const value = sign(null, Buffer.from(canonicalJson(body)), key).toString('base64');
  return {
    ...body,
    signature: {
      alg: 'ed25519',
      keyId: publicKeyId(createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString()),
      value,
      signedAt: Date.now(),
    },
  };
}

/** Verify a signed verdict; returns false on missing/tampered signatures. */
export function verifyVerdict(verdict, publicKeyPem) {
  if (verdict === null || typeof verdict !== 'object') return false;
  const signature = verdict.signature;
  if (signature === null || typeof signature !== 'object' || signature.alg !== 'ed25519' || typeof signature.value !== 'string') return false;
  if (signature.keyId !== publicKeyId(publicKeyPem)) return false;
  const body = signedBody(verdict);
  try {
    return verify(null, Buffer.from(canonicalJson(body)), createPublicKey(publicKeyPem), Buffer.from(signature.value, 'base64'));
  } catch {
    return false;
  }
}
