/**
 * Keyless attestation via sigstore.
 *
 * A local Ed25519 signature proves only that whoever wrote the verdict also had
 * the key, and the key lives next to the verdict. A keyless bundle answers a
 * different question: which workflow, in which repository, at what time. That
 * is the evidence chain SLSA describes.
 *
 * cosign is optional. When it is absent the result is `unavailable` and the
 * caller must treat that as "no attestation", never as "attested".
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ATTEST_RESULT = Object.freeze({
  OK: 'ok',
  UNAVAILABLE: 'unavailable',
  FAILED: 'failed',
});

const DEFAULT_TIMEOUT_MS = 120_000;

function normalize(error) {
  if (error?.code === 'ENOENT') return ATTEST_RESULT.UNAVAILABLE;
  return ATTEST_RESULT.FAILED;
}

function detail(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
  const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
  return stderr || stdout || (error instanceof Error ? error.message : String(error ?? ''));
}

/**
 * Produce a sigstore bundle for a file.
 * @param file - path to the artifact being attested.
 * @param options - `{ bundle, bin, timeoutMs, run }`.
 * @returns `{ result, bundle, detail }`.
 */
export async function signBlob(file, options = {}) {
  const bundle = typeof options.bundle === 'string' && options.bundle !== '' ? options.bundle : `${file}.sigstore.json`;
  const bin = typeof options.bin === 'string' && options.bin !== '' ? options.bin : 'cosign';
  const run = typeof options.run === 'function' ? options.run : execFileAsync;
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  try {
    await run(bin, ['sign-blob', '--yes', '--bundle', bundle, file], { timeout: timeoutMs });
    return { result: ATTEST_RESULT.OK, bundle, detail: '' };
  } catch (error) {
    return { result: normalize(error), bundle, detail: detail(error) };
  }
}

/**
 * Verify a sigstore bundle against the workflow identity that produced it.
 * @param file - the attested artifact.
 * @param options - `{ bundle, bin, identityRegexp, issuer, timeoutMs, run }`.
 */
export async function verifyBlob(file, options = {}) {
  const bundle = typeof options.bundle === 'string' && options.bundle !== '' ? options.bundle : `${file}.sigstore.json`;
  const bin = typeof options.bin === 'string' && options.bin !== '' ? options.bin : 'cosign';
  const run = typeof options.run === 'function' ? options.run : execFileAsync;
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const issuer = typeof options.issuer === 'string' && options.issuer !== ''
    ? options.issuer
    : 'https://token.actions.githubusercontent.com';
  const argv = ['verify-blob', '--bundle', bundle, '--certificate-oidc-issuer', issuer];
  if (typeof options.identityRegexp === 'string' && options.identityRegexp !== '') {
    argv.push('--certificate-identity-regexp', options.identityRegexp);
  }
  argv.push(file);
  try {
    await run(bin, argv, { timeout: timeoutMs });
    return { result: ATTEST_RESULT.OK, bundle, detail: '' };
  } catch (error) {
    return { result: normalize(error), bundle, detail: detail(error) };
  }
}
