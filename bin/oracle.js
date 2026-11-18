#!/usr/bin/env node
/** CLI: relational oracles over a verification plan. */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { runCommand } from '../lib/exec.js';
import { RELATION, checkDecomposition, checkDeterminism, checkInvariance } from '../lib/oracle.js';

const EXIT = { pass: 0, fail: 1, unknown: 2, flaky: 2 };

function parseArgs(argv) {
  const options = { relation: null, plan: null, cwd: process.cwd(), runs: 3, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--plan') options.plan = argv[++index] ?? null;
    else if (arg === '--cwd') options.cwd = argv[++index] ?? options.cwd;
    else if (arg === '--runs') options.runs = Number.parseInt(argv[++index] ?? '3', 10);
    else if (options.relation === null && Object.values(RELATION).includes(arg)) options.relation = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: dsh-oracle <determinism|invariance|decomposition> --plan <plan.json> [--cwd <dir>] [--runs N] [--json]',
    '',
    'determinism   the same plan twice must produce the same per-check status',
    'invariance    the verdict must not change when only ambient state changes (TZ)',
    'decomposition a check declaring composedOf must agree with its parts',
    '',
    'Exit: 0 pass, 1 fail, 2 unknown or error.',
  ].join('\n');
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
  if (options.help || options.relation === null || options.plan === null) {
    console.log(usage());
    process.exitCode = options.help ? 0 : 2;
    return;
  }

  let plan;
  try {
    plan = JSON.parse(await fs.readFile(path.resolve(options.plan), 'utf8'));
  } catch (error) {
    console.error(`could not read plan: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }

  const shared = { plan, cwd: path.resolve(options.cwd), runCommand };
  let verdict;
  try {
    if (options.relation === RELATION.DETERMINISM) verdict = await checkDeterminism({ ...shared, runs: options.runs });
    else if (options.relation === RELATION.INVARIANCE) verdict = await checkInvariance(shared);
    else verdict = await checkDecomposition(shared);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(verdict, null, 2));
  } else {
    console.log(`${verdict.relation}: ${verdict.status.toUpperCase()} — ${verdict.reason}`);
  }
  process.exitCode = EXIT[verdict.status] ?? 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
