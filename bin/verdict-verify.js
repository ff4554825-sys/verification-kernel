#!/usr/bin/env node
/** Verify an Ed25519-signed verdict artifact. */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { verifyVerdict } from '../lib/sign.js';

function usage() {
  return 'Usage: dsh-verdict-verify --verdict <latest.json> --pub <verification.pub> [--json]';
}

function parseArgs(argv) {
  const options = { verdict: null, pub: null, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--verdict') options.verdict = argv[++index] ?? null;
    else if (arg === '--pub') options.pub = argv[++index] ?? null;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.verdict === null || options.pub === null) {
    console.error('both --verdict and --pub are required');
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  const verdict = JSON.parse(await fs.readFile(path.resolve(options.verdict), 'utf8'));
  const publicKey = await fs.readFile(path.resolve(options.pub), 'utf8');
  const valid = verifyVerdict(verdict, publicKey);
  const result = {
    valid,
    keyId: verdict.signature?.keyId ?? null,
    status: verdict.status ?? null,
    project: verdict.id ?? null,
  };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(valid ? `valid signature (${result.keyId})` : 'INVALID signature');
  process.exitCode = valid ? 0 : 1;
}

await main();
