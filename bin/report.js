#!/usr/bin/env node
/** CLI: summarize verification trace metrics. */

import path from 'node:path';
import process from 'node:process';
import { summarizeTrace, formatSummary } from '../lib/report.js';

function usage() {
  return [
    'Usage: dsh-verify-report [--dir <artifactDir>] [--trace <trace.jsonl>] [--json]',
    '',
    'Defaults: --dir .dsh/verification, --trace <dir>/trace.jsonl',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { dir: path.resolve('.dsh/verification'), trace: '', json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--dir') options.dir = path.resolve(argv[++index] ?? '.');
    else if (arg === '--trace') options.trace = argv[++index] ?? '';
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
  const tracePath = options.trace === '' ? path.join(options.dir, 'trace.jsonl') : path.resolve(options.trace);
  const summary = await summarizeTrace(tracePath);
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else console.log(formatSummary(summary));
}

await main();
