#!/usr/bin/env node
/** CLI: keyless sigstore attestation for a verdict artifact. */

import path from 'node:path';
import process from 'node:process';
import { ATTEST_RESULT, signBlob, verifyBlob } from '../lib/attest.js';

const EXIT = { ok: 0, unavailable: 3, failed: 1 };

function parseArgs(argv) {
  const options = {
    command: null,
    file: null,
    bundle: null,
    identityRegexp: null,
    issuer: null,
    bin: process.env.COSIGN_BIN ?? null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--file') options.file = argv[++index] ?? null;
    else if (arg === '--bundle') options.bundle = argv[++index] ?? null;
    else if (arg === '--identity-regexp') options.identityRegexp = argv[++index] ?? null;
    else if (arg === '--issuer') options.issuer = argv[++index] ?? null;
    else if (arg === '--cosign') options.bin = argv[++index] ?? null;
    else if (options.command === null && (arg === 'sign' || arg === 'verify')) options.command = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: dsh-attest <sign|verify> --file <artifact> [options]',
    '',
    '  --bundle <path>           sigstore bundle (default: <artifact>.sigstore.json)',
    '  --identity-regexp <re>    expected workflow identity (verify)',
    '  --issuer <url>            expected OIDC issuer (verify)',
    '  --cosign <path>           cosign binary (default: $COSIGN_BIN or cosign)',
    '  --json',
    '',
    'Exit: 0 attested or verified, 1 refused or failed, 3 cosign unavailable.',
    'Exit 3 is not success: absence of an attestation is not an attestation.',
  ].join('\n');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
    return;
  }
  if (options.help || options.command === null || options.file === null) {
    console.log(usage());
    process.exitCode = options.help ? 0 : 1;
    return;
  }

  const file = path.resolve(options.file);
  const call = options.command === 'sign' ? signBlob : verifyBlob;
  const result = await call(file, {
    ...(options.bundle === null ? {} : { bundle: path.resolve(options.bundle) }),
    ...(options.bin === null ? {} : { bin: options.bin }),
    ...(options.identityRegexp === null ? {} : { identityRegexp: options.identityRegexp }),
    ...(options.issuer === null ? {} : { issuer: options.issuer }),
  });

  const payload = { command: options.command, file, ...result };
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else if (result.result === ATTEST_RESULT.OK) {
    console.log(`${options.command}: ${result.result} (${result.bundle})`);
  } else {
    console.error(`${options.command}: ${result.result}${result.detail === '' ? '' : ` — ${result.detail}`}`);
  }
  process.exitCode = EXIT[result.result] ?? 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
