#!/usr/bin/env node
/** CLI: build and query the local documentation knowledge base. */

import process from 'node:process';
import { indexKnowledge, searchKnowledge } from '../lib/knowledge.js';

function usage() {
  return [
    'Usage: dsh-knowledge --root <dir> --index [--json]',
    '       dsh-knowledge --root <dir> --query <text> [--limit <n>] [--json]',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { root: process.cwd(), query: null, index: false, limit: 5, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--index') options.index = true;
    else if (arg === '--root') options.root = argv[++index] ?? options.root;
    else if (arg === '--query') options.query = argv[++index] ?? null;
    else if (arg === '--limit') options.limit = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && !options.index && options.query === null) throw new Error('--index or --query is required');
  if (!Number.isInteger(options.limit) || options.limit <= 0) throw new Error('--limit must be a positive integer');
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
  const result = options.index
    ? await indexKnowledge({ root: options.root, force: true })
    : await searchKnowledge({ root: options.root, query: options.query, limit: options.limit });
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (options.index) console.log(`Indexed ${result.files} files / ${result.chunks} chunks at ${result.dbPath}`);
  else {
    console.log(`Knowledge: ${result.results.length} result(s) from ${result.root}`);
    for (const item of result.results) console.log(`- ${item.path}:${item.startLine} ${item.title}\n  ${item.snippet.replace(/<[^>]+>/g, '')}`);
  }
}

await main();
