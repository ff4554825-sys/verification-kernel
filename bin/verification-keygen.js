#!/usr/bin/env node
/** Generate an Ed25519 key pair for verdict signing. */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { generateSigningKeys, publicKeyId } from '../lib/sign.js';

function usage() {
  return 'Usage: dsh-verification-keygen [--out-dir <dir>] [--force] [--json]';
}

function parseArgs(argv) {
  const options = { outDir: path.resolve('.dsh', 'keys'), force: false, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out-dir') options.outDir = path.resolve(argv[++index] ?? options.outDir);
    else if (arg === '--force') options.force = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
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
  const privatePath = path.join(options.outDir, 'verification.key');
  const publicPath = path.join(options.outDir, 'verification.pub');
  await fs.mkdir(options.outDir, { recursive: true });
  if (!options.force) {
    for (const file of [privatePath, publicPath]) {
      try {
        await fs.access(file);
        throw new Error(`${file} exists; use --force to overwrite`);
      } catch (error) {
        if (error instanceof Error && error.message.includes('exists')) throw error;
      }
    }
  }
  const keys = generateSigningKeys();
  await fs.writeFile(privatePath, keys.privateKey, { encoding: 'utf8', mode: 0o600 });
  await fs.writeFile(publicPath, keys.publicKey, 'utf8');
  const result = { privateKey: privatePath, publicKey: publicPath, keyId: publicKeyId(keys.publicKey) };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`private: ${result.privateKey}\npublic:  ${result.publicKey}\nkeyId:   ${result.keyId}`);
}

await main();
