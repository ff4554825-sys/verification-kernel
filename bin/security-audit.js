#!/usr/bin/env node
/** CLI: run available secret/static security scanners and normalize findings. */

import path from 'node:path';
import process from 'node:process';
import { auditSecurity } from '../lib/security.js';

function usage() {
  return [
    'Usage: dsh-security-audit [--cwd <dir>] [--tools-dir <dir>] [--rules <semgrep.yml>] [--json]',
    '',
    'Exit 0: scanners ran and no high findings. Exit 1: high findings.',
    'Exit 2: no scanner could run (missing/failed tools).',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    toolsDir: path.resolve('tools', 'bin'),
    rules: path.resolve('tools', 'semgrep', 'rules.yml'),
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--cwd') options.cwd = path.resolve(argv[++index] ?? '.');
    else if (arg === '--tools-dir') options.toolsDir = path.resolve(argv[++index] ?? '');
    else if (arg === '--rules') options.rules = path.resolve(argv[++index] ?? '');
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
  try {
    const result = await auditSecurity({
      cwd: options.cwd,
      toolsDir: options.toolsDir,
      semgrepRules: options.rules,
    });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Security findings: ${result.summary.total} (high ${result.summary.high}, medium ${result.summary.medium}, low ${result.summary.low})`);
      for (const tool of result.tools) console.log(`- ${tool.name}: ${tool.status}${tool.error === '' ? '' : ` — ${tool.error}`}`);
      for (const finding of result.findings.slice(0, 20)) {
        console.log(`  [${finding.severity}] ${finding.tool}/${finding.rule}: ${finding.file}:${finding.line} — ${finding.message}`);
      }
    }
    const ran = result.tools.some((tool) => tool.status === 'ok');
    process.exitCode = result.summary.high > 0 ? 1 : ran ? 0 : 2;
  } catch (error) {
    console.error(`Security audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

await main();
