#!/usr/bin/env node
/** CLI: apply the local three-factor retrieval policy update. */

import path from 'node:path';
import process from 'node:process';
import {
  readPolicy,
  rewardFromStatus,
  updatePolicy,
  writePolicy,
} from '../lib/local-learner.js';

function usage() {
  return [
    'Usage: dsh-local-learn --key <retrieval-key> --pre <n> --post <n>',
    '       (--reward <n> | --status pass|fail|unknown) [--policy <json>]',
    '       [--eta <n>] [--lambda <n>] [--rho <n>] [--sigma <n>] [--dry-run] [--json]',
    '       dsh-local-learn --show [--policy <json>] [--json]',
    '',
    'Δω = η·(pre·post·(reward-baseline))·(λ·ρ·σ); clipped local weight, not model training.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    policy: path.resolve('.dsh', 'learning', 'retrieval-policy.json'),
    key: null,
    pre: 1,
    post: 1,
    reward: null,
    status: null,
    show: false,
    dryRun: false,
    json: false,
    help: false,
    params: {},
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--show') options.show = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--policy') options.policy = path.resolve(argv[++index] ?? options.policy);
    else if (arg === '--key') options.key = argv[++index] ?? null;
    else if (arg === '--pre') options.pre = Number(argv[++index]);
    else if (arg === '--post') options.post = Number(argv[++index]);
    else if (arg === '--reward') options.reward = Number(argv[++index]);
    else if (arg === '--status') options.status = argv[++index] ?? null;
    else if (arg === '--eta') options.params.eta = Number(argv[++index]);
    else if (arg === '--lambda') options.params.lambda = Number(argv[++index]);
    else if (arg === '--rho') options.params.rho = Number(argv[++index]);
    else if (arg === '--sigma') options.params.sigma = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help) {
    if (options.show) return options;
    if (options.key === null) throw new Error('--key is required unless --show');
    if (options.reward === null && options.status === null) throw new Error('--reward or --status is required');
    if (options.status !== null && !['pass', 'fail', 'unknown'].includes(options.status)) throw new Error('--status must be pass|fail|unknown');
    for (const [name, value] of Object.entries(options.params)) {
      if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
    }
    if (!Number.isFinite(options.pre) || !Number.isFinite(options.post)) throw new Error('--pre and --post must be numbers');
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
  const current = await readPolicy(options.policy);
  if (options.show) {
    const payload = { policy: options.policy, baseline: current.baseline, weights: current.weights, history: current.history.slice(-5) };
    if (options.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`Policy: ${options.policy}`);
      console.log(`baseline: ${current.baseline}`);
      for (const [key, weight] of Object.entries(current.weights).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`- ${key}: ${weight}`);
    }
    return;
  }
  const reward = options.reward !== null ? options.reward : rewardFromStatus(options.status);
  const result = updatePolicy(current, { key: options.key, pre: options.pre, post: options.post, reward }, options.params);
  if (!options.dryRun) await writePolicy(options.policy, result.policy);
  const payload = {
    policy: options.policy,
    key: options.key,
    pre: options.pre,
    post: options.post,
    reward,
    baselineBefore: current.baseline,
    ...result,
    dryRun: options.dryRun,
  };
  if (options.json) console.log(JSON.stringify(payload, null, 2));
  else console.log(`${options.key}: Δ=${result.delta} weight=${result.weight} baseline=${result.baseline}${options.dryRun ? ' (dry-run)' : ''}`);
}

await main();
