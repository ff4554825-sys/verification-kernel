#!/usr/bin/env node
/** CLI: calibrate check reliability from outcome JSONL. */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { calibrateOutcomes } from '../lib/calibration.js';
import { readOutcomes } from '../lib/outcomes.js';

function usage() {
  return [
    'Usage: dsh-calibrate [--store <outcomes.jsonl>] [--out <calibration.json>]',
    '       [--min-runs <n>] [--flaky <0-1>] [--unknown <0-1>]',
    '       [--slow-ms <n>] [--fast-ms <n>] [--json] [--no-write]',
    '',
    'Advisory only: never edits project config or disables a required check.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    store: path.resolve('.dsh', 'verification', 'outcomes.jsonl'),
    out: path.resolve('.dsh', 'verification', 'calibration.json'),
    minRuns: 5,
    flaky: 0.1,
    unknown: 0.1,
    slowMs: 60_000,
    fastMs: 5_000,
    json: false,
    write: true,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--no-write') options.write = false;
    else if (arg === '--store') options.store = path.resolve(argv[++index] ?? options.store);
    else if (arg === '--out') options.out = path.resolve(argv[++index] ?? options.out);
    else if (arg === '--min-runs') options.minRuns = Number(argv[++index]);
    else if (arg === '--flaky') options.flaky = Number(argv[++index]);
    else if (arg === '--unknown') options.unknown = Number(argv[++index]);
    else if (arg === '--slow-ms') options.slowMs = Number(argv[++index]);
    else if (arg === '--fast-ms') options.fastMs = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  for (const [name, value] of [['--min-runs', options.minRuns], ['--flaky', options.flaky], ['--unknown', options.unknown], ['--slow-ms', options.slowMs], ['--fast-ms', options.fastMs]]) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  }
  if (options.minRuns < 1) throw new Error('--min-runs must be >= 1');
  if (options.flaky > 1 || options.unknown > 1) throw new Error('--flaky and --unknown must be <= 1');
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
  const records = await readOutcomes(options.store);
  const report = calibrateOutcomes(records, {
    minRuns: options.minRuns,
    flakyThreshold: options.flaky,
    unknownThreshold: options.unknown,
    slowP95Ms: options.slowMs,
    fastP95Ms: options.fastMs,
  });
  if (options.write) {
    await fs.mkdir(path.dirname(options.out), { recursive: true });
    await fs.writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Calibration: ${report.totalRecords} records, ${report.recordsWithCheckDetails} with check details`);
    for (const recommendation of report.recommendations) {
      console.log(`- ${recommendation.type}: ${recommendation.project}/${recommendation.check} — ${recommendation.reason}`);
    }
    if (options.write) console.log(`Report: ${options.out}`);
  }
}

await main();
