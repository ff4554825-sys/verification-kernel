#!/usr/bin/env node
/** CLI: deterministic verification workflow. */

import path from 'node:path';
import process from 'node:process';
import { runVerificationWorkflow } from '../lib/workflow.js';

function usage() {
  return [
    'Usage: dsh-verification-workflow --plan <plan.json> [--cwd <dir>] [--project <id>]',
    '       [--isolation host|wsl] [--mode enforce|dry-run|off] [--attempt <n>]',
    '       [--max-attempts <n>] [--sign-key <pem>] [--outcome-store <jsonl>]',
    '       [--no-artifacts] [--json]',
    '',
    'Phases: resolve → execute → evidence → gate → report.',
    'Exit: 0 pass, 1 fail, 2 unknown/error.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    plan: null,
    project: null,
    isolation: 'host',
    mode: 'enforce',
    attempt: 0,
    maxAttempts: 2,
    signKey: null,
    outcomeStore: '.dsh/verification/outcomes.jsonl',
    artifacts: true,
    distro: process.env.WSL_DISTRO || 'Ubuntu-22.04',
    wslTimeoutMs: 5 * 60_000,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--no-artifacts') options.artifacts = false;
    else if (arg === '--cwd') options.cwd = argv[++index] ?? options.cwd;
    else if (arg === '--plan') options.plan = argv[++index] ?? null;
    else if (arg === '--project') options.project = argv[++index] ?? null;
    else if (arg === '--isolation') options.isolation = argv[++index] ?? options.isolation;
    else if (arg === '--mode') options.mode = argv[++index] ?? options.mode;
    else if (arg === '--attempt') options.attempt = Number(argv[++index]);
    else if (arg === '--max-attempts') options.maxAttempts = Number(argv[++index]);
    else if (arg === '--sign-key') options.signKey = argv[++index] ?? null;
    else if (arg === '--outcome-store') options.outcomeStore = argv[++index] ?? '';
    else if (arg === '--distro') options.distro = argv[++index] ?? options.distro;
    else if (arg === '--wsl-timeout-ms') options.wslTimeoutMs = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && (typeof options.plan !== 'string' || options.plan === '')) throw new Error('--plan is required');
  if (!Number.isInteger(options.attempt) || options.attempt < 0) throw new Error('--attempt must be a non-negative integer');
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 0) throw new Error('--max-attempts must be a non-negative integer');
  if (!Number.isFinite(options.wslTimeoutMs) || options.wslTimeoutMs <= 0) throw new Error('--wsl-timeout-ms must be positive');
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
  const result = await runVerificationWorkflow({
    planPath: options.plan,
    cwd: options.cwd,
    project: options.project,
    isolation: options.isolation,
    mode: options.mode,
    attempt: options.attempt,
    maxAttempts: options.maxAttempts,
    signKey: options.signKey,
    outcomeStore: options.outcomeStore,
    artifacts: options.artifacts,
    distro: options.distro,
    wslTimeoutMs: options.wslTimeoutMs,
  });
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (result.verdict !== null) {
    console.log(`Verification workflow: ${String(result.verdict.status).toUpperCase()} — ${result.verdict.reason}`);
    for (const phase of result.phases) console.log(`- ${phase.name}: ${phase.status} (${phase.durationMs}ms)`);
    console.log(`- gate: ${result.gate?.action ?? 'n/a'} (${result.gate?.reason ?? 'n/a'})`);
    if (result.workflowPath !== '') console.log(`Workflow: ${result.workflowPath}`);
    if (result.artifactPath !== '') console.log(`Evidence: ${result.artifactPath}`);
  } else {
    console.error(`Verification workflow failed at ${result.stage}: ${result.error}`);
  }
  process.exitCode = result.verdict?.status === 'pass' ? 0 : result.verdict?.status === 'fail' ? 1 : 2;
}

await main();
