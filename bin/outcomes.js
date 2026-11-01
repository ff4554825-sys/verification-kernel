#!/usr/bin/env node
/** CLI: append a verdict to the outcome store or report cost/latency metrics. */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { appendOutcome, outcomeFromVerdict, readOutcomes, summarizeOutcomes } from '../lib/outcomes.js';

function usage() {
  return [
    'Usage: dsh-outcomes --append <latest.json> --store <outcomes.jsonl> [--project <id>] [--json]',
    '       dsh-outcomes --report --store <outcomes.jsonl> [--json]',
    '',
    'Cost is a deterministic check-time proxy (check ms + overhead + retries),',
    'not a token or money estimate.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { store: path.resolve('.dsh', 'outcomes.jsonl'), append: null, report: false, project: null, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--append') options.append = argv[++index] ?? null;
    else if (arg === '--store') options.store = path.resolve(argv[++index] ?? options.store);
    else if (arg === '--project') options.project = argv[++index] ?? null;
    else if (arg === '--report') options.report = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && !options.report && options.append === null) throw new Error('--append or --report is required');
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
  if (options.append !== null) {
    const verdict = JSON.parse(await fs.readFile(path.resolve(options.append), 'utf8'));
    const record = outcomeFromVerdict(verdict, { project: options.project });
    await appendOutcome(options.store, record);
    if (options.json) console.log(JSON.stringify(record, null, 2));
    else console.log(`Recorded ${record.project}: ${record.status} in ${record.durationMs}ms`);
  }
  if (options.report) {
    const summary = summarizeOutcomes(await readOutcomes(options.store));
    if (options.json) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(`Outcomes: ${summary.total} (pass ${summary.counts.pass}, fail ${summary.counts.fail}, unknown ${summary.counts.unknown}, flaky ${summary.counts.flaky})`);
      console.log(`Latency: p50 ${summary.latencyMs.p50}ms, p95 ${summary.latencyMs.p95}ms, max ${summary.latencyMs.max}ms`);
      console.log(`Cost proxy: ${summary.cost.totalMs}ms check time, ${summary.cost.retries} retries`);
    }
  }
}

await main();
