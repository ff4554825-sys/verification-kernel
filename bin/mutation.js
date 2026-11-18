#!/usr/bin/env node
/** CLI: mutation-based check-quality audit. */

import path from 'node:path';
import process from 'node:process';
import { DEFAULT_MUTATIONS, runMutations } from '../lib/mutation.js';

function usage() {
  return [
    'Usage: dsh-mutation [--cwd <dir>] [--min-score <0-100>] [--timeout <ms>] [--json]',
    '',
    'Runs curated mutations against the test suite. A killed mutant means the',
    'tests caught the injected bug; a survived mutant means the suite missed it.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    minScore: 0,
    timeoutMs: 120_000,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--cwd') options.cwd = path.resolve(argv[++index] ?? '.');
    else if (arg === '--min-score') options.minScore = Number(argv[++index]);
    else if (arg === '--timeout') options.timeoutMs = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.minScore) || options.minScore < 0 || options.minScore > 100) throw new Error('--min-score must be 0..100');
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('--timeout must be a positive integer');
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
  try {
    const result = await runMutations({
      cwd: options.cwd,
      mutations: DEFAULT_MUTATIONS,
      timeoutMs: options.timeoutMs,
    });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      for (const item of result.results) {
        console.log(`${item.status.padEnd(8)} ${item.id} — ${item.description}${item.error === undefined ? '' : ` (${item.error})`}`);
      }
      console.log(`Mutation score: ${result.score}% (${result.killed} killed, ${result.survived} survived, ${result.invalid} invalid)`);
    }
    process.exitCode = result.score >= options.minScore ? 0 : 1;
  } catch (error) {
    console.error(`Mutation audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

await main();
