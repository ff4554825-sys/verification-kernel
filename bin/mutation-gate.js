#!/usr/bin/env node
/** CLI: enforce a Stryker mutation-score threshold from a JSON report. */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function usage() {
  return [
    'Usage: dsh-mutation-gate [--report <stryker.json>] [--min <0-100>]',
    '',
    'Stryker counts Killed and Timeout as detected; Survived/NoCoverage are missed.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    report: path.resolve('.dsh', 'mutation', 'stryker.json'),
    min: 80,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--report') options.report = path.resolve(argv[++index] ?? '');
    else if (arg === '--min') options.min = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.min) || options.min < 0 || options.min > 100) throw new Error('--min must be 0..100');
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
    const report = JSON.parse(await fs.readFile(options.report, 'utf8'));
    const mutants = Object.values(report.files ?? {}).flatMap((file) => file.mutants ?? []);
    const detected = mutants.filter((mutant) => mutant.status === 'Killed' || mutant.status === 'Timeout').length;
    const total = mutants.length;
    const score = total === 0 ? 0 : Number(((detected / total) * 100).toFixed(2));
    console.log(`Mutation score: ${score}% (${detected}/${total} detected; minimum ${options.min}%)`);
    process.exitCode = score >= options.min ? 0 : 1;
  } catch (error) {
    console.error(`Mutation gate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

await main();
