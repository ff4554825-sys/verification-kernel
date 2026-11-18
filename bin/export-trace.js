#!/usr/bin/env node
/** CLI: export trace.jsonl to an eval-friendly JSON document. */

import path from 'node:path';
import process from 'node:process';
import { exportTraceFile, writeExport } from '../lib/trace-export.js';

function usage() {
  return [
    'Usage: dsh-export-trace [--dir <artifactDir>] [--trace <trace.jsonl>] [--out <file>]',
    '',
    'Without --out, prints the exported document to stdout.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    dir: path.resolve('.dsh/verification'),
    trace: '',
    out: '',
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dir') options.dir = path.resolve(argv[++index] ?? '.');
    else if (arg === '--trace') options.trace = argv[++index] ?? '';
    else if (arg === '--out') options.out = argv[++index] ?? '';
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
  try {
    if (options.out === '') {
      const document = await exportTraceFile(tracePath);
      console.log(JSON.stringify(document, null, 2));
    } else {
      const { outputPath } = await writeExport(tracePath, path.resolve(options.out));
      console.log(`Exported: ${outputPath}`);
    }
  } catch (error) {
    console.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

await main();
