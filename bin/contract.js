#!/usr/bin/env node
/** CLI: validate an acceptance contract and print its checklist. */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { normalizeContract, formatChecklist } from '../lib/contract.js';

function usage() {
  return [
    'Usage: dsh-verify-contract --file <contract.json> [--json]',
    '',
    'The contract is a planning/acceptance artifact; it does not replace the',
    'deterministic checks run by verification_run.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { file: '', json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--file') options.file = argv[++index] ?? '';
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
  if (options.help || options.file === '') {
    console.log(usage());
    process.exitCode = options.help ? 0 : 2;
    return;
  }
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(path.resolve(options.file), 'utf8'));
  } catch (error) {
    console.error(`Cannot read contract: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }
  const normalized = normalizeContract(raw);
  if (normalized.contract === null) {
    if (options.json) console.log(JSON.stringify({ ok: false, errors: normalized.errors }, null, 2));
    else console.error(`Invalid contract:\n- ${normalized.errors.join('\n- ')}`);
    process.exitCode = 2;
    return;
  }
  if (options.json) console.log(JSON.stringify({ ok: true, contract: normalized.contract }, null, 2));
  else console.log(formatChecklist(normalized.contract));
}

await main();
