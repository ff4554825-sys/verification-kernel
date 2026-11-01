#!/usr/bin/env node
/** CLI: run a verification plan and exit 0 (pass), 1 (fail), or 2 (unknown/error). */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { normalizePlan, runPlan, renderVerdict } from '../lib/kernel.js';
import { runCommand } from '../lib/exec.js';
import { writeVerdictArtifacts } from '../lib/artifacts.js';
import { signVerdict } from '../lib/sign.js';

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
    'Usage: dsh-verify --plan <plan.json> [--cwd <dir>] [--check <id>]... [--sign-key <pem>] [--json] [--no-artifacts]',
    '',
    'Plan shape:',
    '  { "id": "my-plan", "checks": [',
    '    { "id": "tests", "argv": ["node", "test.mjs"], "required": true, "timeoutMs": 60000 }',
    '  ] }',
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
  process.exitCode = verdict.status === 'pass' ? 0 : verdict.status === 'fail' ? 1 : 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 2;
});
