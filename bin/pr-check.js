#!/usr/bin/env node
/** CLI: local PR-level review + isolated QA test-patch. */

import process from 'node:process';
import { runPrCheck } from '../lib/pr-check.js';

function usage() {
  return [
    'Usage: dsh-pr-check [--cwd <dir>] [--base HEAD] [--git <path>] [--out <dir>]',
    '       [--qa-command \'["node","--test","test/all.test.js"]\'] [--json]',
    '',
    'Review is advisory; QA executes the diff in a detached worktree.',
    'Exit 0 for review-only/pass, 1 for QA failure, 2 for invalid input.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { cwd: process.cwd(), base: 'HEAD', gitPath: 'git', outDir: '.dsh/pr-check', qaCommand: null, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--cwd') options.cwd = argv[++index] ?? options.cwd;
    else if (arg === '--base') options.base = argv[++index] ?? options.base;
    else if (arg === '--git') options.gitPath = argv[++index] ?? options.gitPath;
    else if (arg === '--out') options.outDir = argv[++index] ?? options.outDir;
    else if (arg === '--qa-command') {
      const raw = argv[++index] ?? '';
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('--qa-command must be a JSON argv array');
      }
      if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((value) => typeof value === 'string')) {
        throw new Error('--qa-command must be a non-empty JSON string array');
      }
      options.qaCommand = parsed;
    } else throw new Error(`unknown argument: ${arg}`);
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
  try {
    const result = await runPrCheck(options);
    const payload = {
      status: result.status,
      root: result.root,
      base: result.base,
      files: result.files,
      lines: result.lines,
      review: result.review,
      qa: result.qa,
      reportPath: result.reportPath,
    };
    if (options.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`PR check: ${payload.status}`);
      console.log(`files=${payload.files} +${payload.lines.added}/-${payload.lines.deleted}`);
      console.log(`review: ${payload.review.promptPath}`);
      if (payload.qa !== null) console.log(`QA: ${payload.qa.ok ? 'pass' : 'fail'} (${payload.qa.stage})`);
      console.log(`report: ${payload.reportPath}`);
    }
    if (result.status === 'fail') process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

await main();
