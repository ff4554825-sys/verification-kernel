#!/usr/bin/env node
/** CLI: create or revoke a human override for the verification gate. */

import path from 'node:path';
import process from 'node:process';
import { revokeOverride, writeOverride } from '../lib/override.js';

function usage() {
  return [
    'Usage: dsh-verify-override --reason <text> [--project <id|*>] [--minutes <n>]',
    '       [--dir <cwd>] [--path <override.json>] [--plan-hash <hash>] [--verdict-hash <hash>]',
    '       dsh-verify-override --revoke [--dir <cwd>] [--path <override.json>]',
    '',
    'The override is cooperative: it is a file in the project workspace and is',
    'not a security boundary. Use a separate user/process or CI for enforcement.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    dir: process.cwd(),
    path: '',
    reason: '',
    project: '*',
    minutes: 60,
    planHash: undefined,
    verdictHash: undefined,
    revoke: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--revoke') options.revoke = true;
    else if (arg === '--dir') options.dir = argv[++index] ?? options.dir;
    else if (arg === '--path') options.path = argv[++index] ?? '';
    else if (arg === '--reason') options.reason = argv[++index] ?? '';
    else if (arg === '--project') options.project = argv[++index] ?? '*';
    else if (arg === '--minutes') {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value <= 0) throw new Error('--minutes must be a positive integer');
      options.minutes = value;
    } else if (arg === '--plan-hash') options.planHash = argv[++index] ?? '';
    else if (arg === '--verdict-hash') options.verdictHash = argv[++index] ?? '';
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
  const dir = path.resolve(options.dir);
  const filePath = options.path === '' ? path.join(dir, '.dsh', 'verification', 'override.json') : path.resolve(dir, options.path);
  try {
    if (options.revoke) {
      const removed = await revokeOverride(filePath);
      console.log(removed ? `Revoked override: ${filePath}` : `No override to revoke: ${filePath}`);
      return;
    }
    if (options.reason.trim() === '') {
      console.error('--reason is required (use --revoke to remove an override)');
      console.error(usage());
      process.exitCode = 2;
      return;
    }
    const now = Date.now();
    const { path: written, override } = await writeOverride(filePath, {
      reason: options.reason,
      project: options.project,
      createdAt: now,
      expiresAt: now + options.minutes * 60_000,
      ...(options.planHash === undefined ? {} : { planHash: options.planHash }),
      ...(options.verdictHash === undefined ? {} : { verdictHash: options.verdictHash }),
    }, now);
    console.log(`Override written: ${written}`);
    console.log(`Project: ${override.project} · expires: ${new Date(override.expiresAt).toISOString()}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

await main();
