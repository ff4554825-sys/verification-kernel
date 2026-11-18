#!/usr/bin/env node
/** CLI: re-derive a verdict from stored evidence without running any check. */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resummarize, renderVerdict } from '../lib/kernel.js';

const EXIT = { pass: 0, fail: 1, unknown: 2, flaky: 2 };

function parseArgs(argv) {
  const options = { dir: '.dsh/verification', file: null, json: false, write: false, expect: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--write') options.write = true;
    else if (arg === '--run') options.dir = argv[++index] ?? options.dir;
    else if (arg === '--file') options.file = argv[++index] ?? null;
    else if (arg === '--expect') options.expect = argv[++index] ?? null;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: dsh-verify-rescore --run <artifact-dir> [--file <verdict.json>] [--write] [--expect <status>] [--json]',
    '',
    'Recomputes status, reason, and unknown reasons from the checks stored in an',
    'artifact. No check is executed: the evidence is already on disk.',
    '',
    'Exit: 0 pass, 1 fail, 2 unknown/flaky or error.',
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
  if (options.help) {
    console.log(usage());
    return;
  }

  const file = options.file === null ? path.join(path.resolve(options.dir), 'latest.json') : path.resolve(options.file);
  let stored;
  try {
    stored = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    console.error(`could not read evidence at ${file}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }

  let verdict;
  try {
    verdict = resummarize(stored);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  const result = {
    file,
    planHash: verdict.planHash,
    originalStatus: verdict.rescoredFrom.status,
    status: verdict.status,
    changed: verdict.rescoredFrom.status !== verdict.status,
    staleSchema: verdict.rescoredFrom.staleSchema,
    unknownReasons: verdict.unknownReasons,
    checks: verdict.checks.map((check) => ({
      id: check.id,
      required: check.required,
      status: check.status,
      ...(check.reason === undefined ? {} : { reason: check.reason }),
    })),
  };

  if (options.write) {
    const target = path.join(path.dirname(file), 'latest.rescored.json');
    await fs.writeFile(target, `${JSON.stringify({ ...verdict, rescoredTo: target }, null, 2)}\n`, 'utf8');
    result.writtenTo = target;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${verdict.rescoredFrom.status} -> ${verdict.status}${result.changed ? ' (changed)' : ' (unchanged)'}`);
    if (result.staleSchema) console.log(`note: evidence was written with an older schema (v${verdict.rescoredFrom.schema})`);
    console.log(renderVerdict(verdict));
    if (result.writtenTo !== undefined) console.log(`written: ${result.writtenTo}`);
  }

  if (options.expect !== null && options.expect !== verdict.status) {
    console.error(`expected ${options.expect}, rescored ${verdict.status}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = EXIT[verdict.status] ?? 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
