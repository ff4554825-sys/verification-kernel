#!/usr/bin/env node
/** CLI: create or revoke a human override for the verification gate. */

import path from 'node:path';
import process from 'node:process';
import { revokeOverride, signOverride, writeOverride, verifyOverrideSignature } from '../lib/override.js';

function usage() {
  return [
    'Usage: dsh-verify-override --reason <text> [--project <id|*>] [--minutes <n>]',
    '       [--dir <cwd>] [--path <override.json>] [--plan-hash <hash>] [--verdict-hash <hash>]',
    '       dsh-verify-override --revoke [--dir <cwd>] [--path <override.json>]',
    '',
    '  --sign-key <pem>   sign the record; a gate with a public key accepts only signed overrides',
    '  --pub <pem>        verify the signature after writing',
    '',
    'An unsigned override is still written, with a warning, so existing setups keep',
    'working. Configure `overridePublicKey` (profile config or',
    'VERIFICATION_OVERRIDE_PUBLIC_KEY) to make signatures mandatory: an unsigned or',
    'invalidly signed file then reads as no override at all.',
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
    let record = {
      reason: options.reason,
      project: options.project ?? '*',
      expiresAt: Date.now() + options.minutes * 60_000,
    };
    if (options.signKey === null) {
      console.error('warning: unsigned override. Any process that can write the workspace can create one; pass --sign-key to sign it.');
    } else {
      const pem = await fs.readFile(path.resolve(options.signKey), 'utf8');
      record = signOverride(record, pem);
    }
    const { path: written, override } = await writeOverride(filePath, {
      ...record,
      createdAt: now,
      expiresAt: now + options.minutes * 60_000,
      ...(options.planHash === undefined ? {} : { planHash: options.planHash }),
      ...(options.verdictHash === undefined ? {} : { verdictHash: options.verdictHash }),
    }, now);
    if (options.pub !== null) {
      const pub = await fs.readFile(path.resolve(options.pub), 'utf8');
      const ok = verifyOverrideSignature(override, pub);
      console.log(`Signature: ${ok ? 'valid' : 'INVALID'}`);
      if (!ok) process.exitCode = 1;
    }
    console.log(`Override written: ${written}`);
    console.log(`Project: ${override.project} · expires: ${new Date(override.expiresAt).toISOString()}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

await main();
