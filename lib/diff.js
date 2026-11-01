/** Diff/scope audit: inspect git changes and enforce allow/deny and size budgets. */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_IGNORE = ['.dsh/verification/', 'node_modules/', '.git/'];

function normalize(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

function globToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Match a repo-relative file against a path prefix or a `*` glob. */
export function matchesPath(file, pattern) {
  const target = normalize(pattern);
  const candidate = normalize(file);
  if (target === '') return false;
  if (target.includes('*')) return globToRegExp(target).test(candidate);
  if (target.endsWith('/')) return candidate === target.slice(0, -1) || candidate.startsWith(target);
  return candidate === target || candidate.startsWith(`${target}/`);
}

function parsePorcelainZ(text) {
  const parts = text.split('\0');
  const entries = [];
  for (let index = 0; index < parts.length; index += 1) {
    const token = parts[index];
    if (token.length < 4) continue;
    const status = token.slice(0, 2);
    const file = normalize(token.slice(3));
    const entry = { status, path: file, added: 0, deleted: 0 };
    if (status[0] === 'R' || status[0] === 'C' || status[1] === 'R' || status[1] === 'C') {
      entry.oldPath = normalize(parts[index + 1] ?? '');
      index += 1;
    }
    entries.push(entry);
  }
  return entries;
}

function parseNumstat(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const [added, deleted, ...rest] = line.split('\t');
    const file = normalize(rest.join('\t'));
    if (file === '') continue;
    map.set(file, {
      added: added === '-' ? 0 : Number(added) || 0,
      deleted: deleted === '-' ? 0 : Number(deleted) || 0,
    });
  }
  return map;
}

export async function git(gitPath, args, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { stdout, stderr } = await execFileAsync(gitPath, args, {
    cwd,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env,
  });
  return { stdout, stderr };
}

/**
 * Inspect tracked and untracked changes relative to `base`.
 * Untracked line counts are read up to 1 MB per file; binary/oversized files
 * count as zero added lines and are flagged.
 */
export async function collectDiff({ cwd, gitPath = 'git', base = 'HEAD', includeUntracked = true, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof cwd !== 'string' || cwd === '') throw new Error('cwd is required');
  const { stdout: rootText } = await git(gitPath, ['rev-parse', '--show-toplevel'], { cwd, timeoutMs });
  const root = rootText.trim();
  if (root === '') throw new Error('not a git repository');
  const [{ stdout: statusText }, { stdout: numstatText }] = await Promise.all([
    git(gitPath, ['status', '--porcelain=v1', '-z'], { cwd: root, timeoutMs }),
    git(gitPath, ['diff', '--numstat', base, '--'], { cwd: root, timeoutMs }),
  ]);
  const entries = parsePorcelainZ(statusText);
  const stats = parseNumstat(numstatText);
  const byPath = new Map();
  for (const entry of entries) {
    if (entry.status === '!!') continue;
    byPath.set(entry.path, { ...entry, ...(stats.get(entry.path) ?? { added: 0, deleted: 0 }) });
  }
  for (const [file, stat] of stats) {
    if (!byPath.has(file)) byPath.set(file, { status: 'M ', path: file, ...stat });
  }
  const files = [...byPath.values()];
  if (includeUntracked) {
    for (const file of files) {
      if (file.status.trim() !== '??') continue;
      try {
        const stat = await fs.stat(path.join(root, file.path));
        if (!stat.isFile() || stat.size > 1024 * 1024) {
          file.large = true;
          continue;
        }
        const text = await fs.readFile(path.join(root, file.path), 'utf8');
        file.added = text === '' ? 0 : text.split(/\r?\n/).length;
      } catch {
        file.unreadable = true;
      }
    }
  }
  const added = files.reduce((sum, file) => sum + (file.added ?? 0), 0);
  const deleted = files.reduce((sum, file) => sum + (file.deleted ?? 0), 0);
  return {
    root,
    base: base.trim(),
    files,
    totals: { files: files.length, added, deleted, lines: added + deleted },
  };
}

/**
 * Audit a collected diff. Return violations; an empty list means the change is
 * within the configured scope and budgets.
 */
export function auditDiff(diff, { allow = [], deny = [], maxFiles = 50, maxLines = 1000, ignore = DEFAULT_IGNORE } = {}) {
  const violations = [];
  const ignored = new Set();
  const files = Array.isArray(diff?.files) ? diff.files : [];
  for (const file of files) {
    if (ignore.some((pattern) => matchesPath(file.path, pattern))) {
      ignored.add(file.path);
      continue;
    }
    if (deny.some((pattern) => matchesPath(file.path, pattern))) {
      violations.push({ kind: 'denied-path', path: file.path, message: `path '${file.path}' matches a denied pattern` });
      continue;
    }
    if (allow.length > 0 && !allow.some((pattern) => matchesPath(file.path, pattern))) {
      violations.push({ kind: 'outside-scope', path: file.path, message: `path '${file.path}' is outside the allowed scope` });
    }
  }
  const scoped = files.filter((file) => !ignored.has(file.path));
  const totals = {
    files: scoped.length,
    added: scoped.reduce((sum, file) => sum + (file.added ?? 0), 0),
    deleted: scoped.reduce((sum, file) => sum + (file.deleted ?? 0), 0),
  };
  totals.lines = totals.added + totals.deleted;
  if (totals.files > maxFiles) violations.push({ kind: 'too-many-files', message: `${totals.files} changed files exceeds maxFiles ${maxFiles}` });
  if (totals.lines > maxLines) violations.push({ kind: 'too-many-lines', message: `${totals.lines} changed lines exceeds maxLines ${maxLines}` });
  return {
    ok: violations.length === 0,
    violations,
    ignored: [...ignored],
    totals,
    maxFiles,
    maxLines,
  };
}
