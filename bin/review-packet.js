#!/usr/bin/env node
/** CLI: build a read-only review packet (JSON or prompt) from a git diff. */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { buildReviewPacket, formatReviewPrompt } from '../lib/review.js';

function usage() {
  return [
    'Usage: dsh-review-packet [--cwd <dir>] [--base <rev>] [--git <path>] [--out <file>] [--prompt]',
    '',
    'Writes JSON by default; --prompt writes a reviewer instruction prompt.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    base: 'HEAD',
    gitPath: process.env.GIT_EXECUTABLE || 'git',
    out: '',
    prompt: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--prompt') options.prompt = true;
    else if (arg === '--cwd') options.cwd = path.resolve(argv[++index] ?? '.');
    else if (arg === '--base') options.base = argv[++index] ?? options.base;
    else if (arg === '--git') options.gitPath = argv[++index] ?? options.gitPath;
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
  try {
    const packet = await buildReviewPacket({ cwd: options.cwd, gitPath: options.gitPath, base: options.base });
    const text = options.prompt ? formatReviewPrompt(packet) : `${JSON.stringify(packet, null, 2)}\n`;
    if (options.out === '') process.stdout.write(text);
    else {
      await fs.writeFile(path.resolve(options.out), text, 'utf8');
      console.log(`Review packet written: ${path.resolve(options.out)}`);
    }
  } catch (error) {
    console.error(`Review packet failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

await main();
