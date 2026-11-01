#!/usr/bin/env node
/** CLI: audit git diff scope and size. Exit 0 ok, 1 violations, 2 error. */

import process from 'node:process';
import { collectDiff, auditDiff } from '../lib/diff.js';

function usage() {
  return [
    'Usage: dsh-diff-audit [--cwd <dir>] [--base <rev>] [--git <path>]',
    '       [--allow <prefix-or-glob>]... [--deny <prefix-or-glob>]...',
    '       [--max-files <n>] [--max-lines <n>] [--json]',
    '',
    'Default ignore: .dsh/verification/, node_modules/, .git/',
    'Base defaults to HEAD; use --base <commit> for a PR base.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    base: 'HEAD',
    gitPath: process.env.GIT_EXECUTABLE || 'git',
    allow: [],
    deny: [],
    maxFiles: 50,
    maxLines: 1000,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--cwd') options.cwd = argv[++index] ?? options.cwd;
    else if (arg === '--base') options.base = argv[++index] ?? options.base;
    else if (arg === '--git') options.gitPath = argv[++index] ?? options.gitPath;
    else if (arg === '--allow') options.allow.push(argv[++index] ?? '');
    else if (arg === '--deny') options.deny.push(argv[++index] ?? '');
    else if (arg === '--max-files') options.maxFiles = Number(argv[++index]);
    else if (arg === '--max-lines') options.maxLines = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.maxFiles) || options.maxFiles < 0) throw new Error('--max-files must be a non-negative integer');
  if (!Number.isInteger(options.maxLines) || options.maxLines < 0) throw new Error('--max-lines must be a non-negative integer');
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
    const diff = await collectDiff({ cwd: options.cwd, gitPath: options.gitPath, base: options.base });
    const audit = auditDiff(diff, {
      allow: options.allow,
      deny: options.deny,
      maxFiles: options.maxFiles,
      maxLines: options.maxLines,
    });
    if (options.json) {
      console.log(JSON.stringify({ diff, audit }, null, 2));
    } else {
      console.log(`Diff: ${audit.totals.files} files, +${audit.totals.added}/-${audit.totals.deleted} lines (${audit.totals.lines} changed)`);
      if (audit.ignored.length > 0) console.log(`Ignored: ${audit.ignored.join(', ')}`);
      if (audit.ok) console.log('Scope: OK');
      else {
        console.log('Scope violations:');
        for (const violation of audit.violations) console.log(`- ${violation.kind}: ${violation.message}`);
      }
    }
    process.exitCode = audit.ok ? 0 : 1;
  } catch (error) {
    console.error(`Diff audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

await main();
