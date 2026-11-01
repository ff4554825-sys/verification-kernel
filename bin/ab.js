#!/usr/bin/env node
/** CLI: paired A/B comparison from two outcome JSONL files. */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { compareAB } from '../lib/ab.js';
import { readOutcomes } from '../lib/outcomes.js';

function usage() {
  return [
    'Usage: dsh-ab --control <outcomes.jsonl> --treatment <outcomes.jsonl>',
    '       [--key task|project|session] [--bootstrap <n>] [--seed <n>] [--json]',
    '',
    'Pairs by key (fallback: taskId/task/project). Pass/fail is observed, not model IQ.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { control: null, treatment: null, key: 'task', bootstrap: 2_000, seed: 0x5eed, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--control') options.control = argv[++index] ?? null;
    else if (arg === '--treatment') options.treatment = argv[++index] ?? null;
    else if (arg === '--key') options.key = argv[++index] ?? options.key;
    else if (arg === '--bootstrap') options.bootstrap = Number(argv[++index]);
    else if (arg === '--seed') options.seed = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && (options.control === null || options.treatment === null)) throw new Error('--control and --treatment are required');
  if (!Number.isInteger(options.bootstrap) || options.bootstrap < 1) throw new Error('--bootstrap must be a positive integer');
  if (!Number.isInteger(options.seed)) throw new Error('--seed must be an integer');
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
  const [control, treatment] = await Promise.all([
    readOutcomes(path.resolve(options.control)),
    readOutcomes(path.resolve(options.treatment)),
  ]);
  const report = compareAB(control, treatment, options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`A/B pairs: ${report.paired.total}`);
    console.log(`pass rate: control ${report.control.passRate} → treatment ${report.treatment.passRate} (Δ ${report.paired.passRateDelta})`);
    console.log(`wins/losses/ties: ${report.paired.wins}/${report.paired.losses}/${report.paired.ties}`);
    console.log(`p50 latency Δ: ${report.paired.latencyDeltaMs}ms; cost Δ: ${report.paired.costDeltaMs}ms`);
    console.log(`bootstrap pass-rate Δ 95% CI: [${report.paired.bootstrapMeanDelta.low}, ${report.paired.bootstrapMeanDelta.high}]`);
  }
}

await main();
