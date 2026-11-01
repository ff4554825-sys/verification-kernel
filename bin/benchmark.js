#!/usr/bin/env node
/** CLI: run a patch-task benchmark under worktree/WSL/Docker isolation. */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { normalizeManifest, runBenchmark } from '../lib/benchmark.js';

function usage() {
  return [
    'Usage: dsh-benchmark --manifest <tasks.json> [--isolation worktree|wsl|docker] [--json] [--fail-fast]',
    '',
    'Manifest: { "tasks": [{ id, cwd, base, patch, command, expected, timeoutMs }] }',
    'expected is pass|fail; results report false accept/reject and accuracy.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    manifest: '',
    isolation: 'worktree',
    json: false,
    failFast: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--fail-fast') options.failFast = true;
    else if (arg === '--manifest') options.manifest = path.resolve(argv[++index] ?? '');
    else if (arg === '--isolation') options.isolation = argv[++index] ?? options.isolation;
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
  if (options.help || options.manifest === '') {
    console.log(usage());
    process.exitCode = options.help ? 0 : 2;
    return;
  }
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(options.manifest, 'utf8'));
  } catch (error) {
    console.error(`Cannot read manifest: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }
  const normalized = normalizeManifest(raw, path.dirname(options.manifest));
  if (normalized.manifest === null) {
    console.error(`Invalid manifest:\n- ${normalized.errors.join('\n- ')}`);
    process.exitCode = 2;
    return;
  }
  try {
    const report = await runBenchmark({
      manifest: normalized.manifest,
      isolation: options.isolation,
      failFast: options.failFast,
    });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else {
      for (const result of report.results) {
        console.log(`${result.matched ? 'OK  ' : 'MISS'} ${result.id}: expected ${result.expected}, got ${result.actual} (${result.stage}${result.exitCode === undefined ? '' : `, exit ${result.exitCode}`})`);
      }
      console.log(`Benchmark: ${report.matched}/${report.total} matched; false accept ${report.falseAccept}; false reject ${report.falseReject}; ${report.durationMs}ms`);
    }
    process.exitCode = report.matched === report.total ? 0 : 1;
  } catch (error) {
    console.error(`Benchmark failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

await main();
