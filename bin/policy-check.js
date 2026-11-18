#!/usr/bin/env node
/** CLI: evaluate a verdict against the OPA policy. */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function usage() {
  return [
    'Usage: dsh-policy-check --input <verdict.json> [--opa <opa.exe>] [--policy <dir>] [--json]',
    '',
    'Exit 0: allowed. Exit 1: denied. Exit 2: policy/tool error.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    input: '',
    opa: process.env.OPA_EXECUTABLE || path.resolve('tools', 'bin', 'opa.exe'),
    policy: path.resolve('policies'),
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--input') options.input = path.resolve(argv[++index] ?? '');
    else if (arg === '--opa') options.opa = path.resolve(argv[++index] ?? '');
    else if (arg === '--policy') options.policy = path.resolve(argv[++index] ?? '');
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
  if (options.help || options.input === '') {
    console.log(usage());
    process.exitCode = options.help ? 0 : 2;
    return;
  }
  try {
    await fs.access(options.input);
    const { stdout } = await execFileAsync(options.opa, [
      'eval',
      '--format', 'json',
      '--data', options.policy,
      '--input', options.input,
      'data.verification.decision',
    ], { timeout: 30_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    const parsed = JSON.parse(stdout);
    const decision = parsed?.result?.[0]?.expressions?.[0]?.value;
    if (decision === undefined) throw new Error('policy returned no decision');
    if (options.json) console.log(JSON.stringify(decision, null, 2));
    else {
      console.log(`Policy: ${decision.allow ? 'ALLOW' : 'DENY'} (${decision.status})`);
      for (const violation of decision.violations ?? []) console.log(`- ${violation}`);
    }
    process.exitCode = decision.allow === true ? 0 : 1;
  } catch (error) {
    console.error(`Policy check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

await main();
