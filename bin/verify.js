#!/usr/bin/env node
/** CLI: run a verification plan and exit 0 (pass), 1 (fail), 2 (unknown/error), or 78 (ask). */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { normalizePlan, runPlan, renderVerdict, ASK_EXIT_CODE } from '../lib/kernel.js';
import { runCommand } from '../lib/exec.js';
import { writeVerdictArtifacts } from '../lib/artifacts.js';
import { signVerdict } from '../lib/sign.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SUBCOMMANDS, subcommandNames } from '../lib/cli.js';

function parseArgs(argv) {
  const options = { cwd: process.cwd(), plan: null, checks: [], json: false, artifacts: true, signKey: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--no-artifacts') options.artifacts = false;
    else if (arg === '--sign-key') options.signKey = argv[++index] ?? null;
    else if (arg === '--cwd') options.cwd = argv[++index] ?? options.cwd;
    else if (arg === '--plan') options.plan = argv[++index] ?? null;
    else if (arg === '--check') options.checks.push(argv[++index] ?? '');
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: dsh-verify [--plan <plan.json>] [--cwd <dir>] [--check <id>]... [--sign-key <pem>] [--json] [--no-artifacts]',
    `       dsh-verify <${subcommandNames().join('|')}> [options]`,
    '',
    'Plan shape:',
    '  { "id": "my-plan", "checks": [',
    '    { "id": "tests", "argv": ["node", "test.mjs"], "required": true, "timeoutMs": 60000 }',
    '  ] }',
  ].join('\n');
}

/**
 * Dispatch `dsh-verify <sub> ...` to the matching script, inheriting stdio and
 * the exit code. `run` is this file, so it is stripped rather than spawned.
 */
function dispatch(argv) {
  const [first, ...rest] = argv;
  if (first === 'run') return { argv: rest };
  const script = SUBCOMMANDS[first];
  if (script === undefined) return null;
  const target = fileURLToPath(new URL(`./${script}`, import.meta.url));
  return { child: target, argv: rest };
}

async function main() {
  const dispatched = dispatch(process.argv.slice(2));
  if (dispatched !== null && dispatched.child !== undefined) {
    await new Promise((resolve) => {
      const child = spawn(process.execPath, [dispatched.child, ...dispatched.argv], { stdio: 'inherit' });
      child.on('exit', (code, signal) => {
        process.exitCode = signal === null ? (code ?? 2) : 2;
        resolve();
      });
      child.on('error', () => {
        process.exitCode = 2;
        resolve();
      });
    });
    return;
  }
  process.argv = [process.argv[0], process.argv[1], ...(dispatched === null ? process.argv.slice(2) : dispatched.argv)];
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help || options.plan === null) {
    console.log(usage());
    process.exitCode = options.help ? 0 : 2;
    return;
  }

  let raw;
  try {
    raw = JSON.parse(await fs.readFile(path.resolve(options.cwd, options.plan), 'utf8'));
  } catch (error) {
    console.error(`Cannot read plan: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }
  const normalized = normalizePlan(raw);
  if (normalized.plan === null) {
    console.error(`Invalid plan:\n- ${normalized.errors.join('\n- ')}`);
    process.exitCode = 2;
    return;
  }

  const controller = new AbortController();
  const onInterrupt = () => controller.abort();
  process.once('SIGINT', onInterrupt);
  let verdict;
  try {
    verdict = await runPlan(normalized.plan, {
      cwd: path.resolve(options.cwd),
      runCommand,
      signal: controller.signal,
      selectedCheckIds: options.checks.length > 0 ? options.checks : undefined,
    });
  } finally {
    process.removeListener('SIGINT', onInterrupt);
  }

  if (options.signKey !== null) {
    try {
      verdict = signVerdict(verdict, await fs.readFile(path.resolve(options.signKey), 'utf8'));
    } catch (error) {
      console.error(`Cannot sign verdict: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
      return;
    }
  }

  let artifacts = null;
  if (options.artifacts) {
    artifacts = await writeVerdictArtifacts(path.resolve(options.cwd), verdict);
    if (artifacts !== null) verdict = { ...verdict, artifactPath: artifacts.latest };
  }

  if (options.json) {
    console.log(JSON.stringify({ verdict, artifacts }, null, 2));
  } else {
    console.log(renderVerdict(verdict));
    if (artifacts !== null) console.log(`Latest: ${artifacts.latest}`);
  }
  process.exitCode = verdict.status === 'pass' ? 0 : verdict.status === 'fail' ? 1 : verdict.status === 'ask' ? ASK_EXIT_CODE : 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 2;
});
