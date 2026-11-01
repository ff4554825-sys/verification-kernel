#!/usr/bin/env node
/** CLI: heuristic trajectory critic for a DSH session log. Advisory only. */

import path from 'node:path';
import process from 'node:process';
import { readSessionEvents } from '../lib/session-log.js';
import { analyzeTrajectory, formatCritic } from '../lib/trajectory.js';

function usage() {
  return [
    'Usage: dsh-critic --session <session.v4.jsonl.zstd> [--json] [--fail-score <n>]',
    '',
    'The score is advisory; it never replaces deterministic checks.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { session: '', json: false, failScore: 60, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--session') options.session = argv[++index] ?? '';
    else if (arg === '--fail-score') {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error('--fail-score must be an integer 0..100');
      options.failScore = value;
    } else throw new Error(`unknown argument: ${arg}`);
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
  if (options.help || options.session === '') {
    console.log(usage());
    process.exitCode = options.help ? 0 : 2;
    return;
  }
  try {
    const events = await readSessionEvents(path.resolve(options.session));
    const report = analyzeTrajectory(events);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatCritic(report));
    process.exitCode = report.score >= options.failScore ? 1 : 0;
  } catch (error) {
    console.error(`Critic failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

await main();
