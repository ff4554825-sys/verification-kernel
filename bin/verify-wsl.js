#!/usr/bin/env node
/** CLI: run the verification CLI inside WSL2 for an independent boundary. */

import process from 'node:process';
import { verifyInWsl } from '../lib/verify-wsl.js';

function usage() {
  return [
    'Usage: dsh-verify-wsl --plan <plan.json> [--cwd <dir>] [--distro <name>]',
    '       [--timeout-ms <n>] [--keep] [--json]',
    '',
    'Copies the project to a WSL2 temp dir, runs the verifier there, and removes it.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    plan: null,
    distro: process.env.WSL_DISTRO || 'Ubuntu-22.04',
    timeoutMs: 120_000,
    keep: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plan') options.plan = argv[++index];
    else if (arg === '--cwd') options.cwd = argv[++index];
    else if (arg === '--distro') options.distro = argv[++index];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--keep') options.keep = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && (typeof options.plan !== 'string' || options.plan === '')) throw new Error('--plan is required');
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('--timeout-ms must be positive');
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
  const result = await verifyInWsl({ ...options, planPath: options.plan });
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (result.verdict) {
    console.log(`WSL verification: ${String(result.verdict.status).toUpperCase()} — ${result.verdict.reason}`);
    for (const check of result.verdict.checks ?? []) console.log(`- ${check.id}: ${check.status}`);
  } else {
    console.error(`WSL verification failed at ${result.stage}: ${result.error ?? result.stderr ?? 'unknown'}`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

await main();
