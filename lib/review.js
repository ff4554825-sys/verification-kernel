/** Build a read-only repo review packet from a git diff and repository rules. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { collectDiff, git } from './diff.js';

const RULE_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'README.md',
  '.cursorrules',
  '.github/pull_request_template.md',
  '.agents/skills/custom-codereview-guide.md',
  '.agents/skills/custom-qa-guide.md',
];

function tail(value, max) {
  if (typeof value !== 'string') return '';
  if (value.length <= max) return value;
  return `…[truncated ${value.length - max} chars]\n${value.slice(-max)}`;
}

export async function buildReviewPacket({
  cwd,
  gitPath = 'git',
  base = 'HEAD',
  maxDiffChars = 120_000,
  maxRuleChars = 12_000,
  timeoutMs = 30_000,
} = {}) {
  const diff = await collectDiff({ cwd, gitPath, base, timeoutMs });
  const [{ stdout: diffText }, { stdout: statText }] = await Promise.all([
    git(gitPath, ['diff', '--no-ext-diff', '--unified=3', base, '--'], { cwd: diff.root, timeoutMs }),
    git(gitPath, ['diff', '--stat', base, '--'], { cwd: diff.root, timeoutMs }),
  ]);
  const rules = [];
  for (const relative of RULE_FILES) {
    const absolute = path.join(diff.root, relative);
    try {
      const text = await fs.readFile(absolute, 'utf8');
      rules.push({ path: relative, text: tail(text, maxRuleChars) });
    } catch {
      /* absent rule file */
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    root: diff.root,
    base: diff.base,
    files: diff.files,
    totals: diff.totals,
    diffStat: tail(statText.trim(), maxDiffChars),
    diff: tail(diffText, maxDiffChars),
    rules,
  };
}

export function formatReviewPrompt(packet) {
  const lines = [
    '# Read-only repo review',
    '',
    'You are an independent reviewer. Do not edit files, install packages, or run mutating commands.',
    'Review the change for correctness, scope, regressions, tests, and security.',
    'Output: risk (green/yellow/red), findings with evidence, and what you could not verify.',
    '',
    `Base: ${packet.base}`,
    `Changed files: ${packet.totals.files}; lines: +${packet.totals.added}/-${packet.totals.deleted}`,
    '',
    '## Diff stat',
    '```',
    packet.diffStat || '(no diff)',
    '```',
    '',
    '## Repository rules',
  ];
  for (const rule of packet.rules) {
    lines.push(`### ${rule.path}`, '```', rule.text, '```');
  }
  lines.push('', '## Diff', '```diff', packet.diff || '(no diff)', '```');
  return lines.join('\n');
}
