/** Deterministic change-complexity router; never trusts a model's "this is simple". */

import fs from 'node:fs/promises';
import path from 'node:path';
import { collectDiff, matchesPath } from './diff.js';

const NON_CODE_EXTENSIONS = new Set(['.md', '.markdown', '.mdx', '.rst', '.txt', '.text', '.adoc', '.asciidoc', '.org', '.log', '.csv', '.tsv']);
const NON_CODE_FILENAMES = new Set(['license', 'licence', 'notice', 'authors', 'contributors', 'changelog', 'codeowners']);
const SNAPSHOT_REL = path.join('.dsh', 'verification', 'tree-snapshot.json');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.dsh', 'tools', 'dist', 'build', 'coverage']);
const MAX_SNAPSHOT_FILES = 2_000;

function normalize(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

export function isNonCodePath(file) {
  const normalized = normalize(file);
  const name = normalized.split('/').at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  const extension = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  return NON_CODE_EXTENSIONS.has(extension) || (extension === '' && NON_CODE_FILENAMES.has(name.toLowerCase()));
}

async function scanTree(root, relative = '', state = { files: {} }) {
  if (Object.keys(state.files).length >= MAX_SNAPSHOT_FILES) return state;
  let entries;
  try {
    entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  } catch {
    return state;
  }
  for (const entry of entries) {
    if (Object.keys(state.files).length >= MAX_SNAPSHOT_FILES) break;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await scanTree(root, relative === '' ? entry.name : `${relative}/${entry.name}`, state);
      continue;
    }
    if (!entry.isFile()) continue;
    const file = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (file === normalize(SNAPSHOT_REL)) continue;
    try {
      const stat = await fs.stat(path.join(root, file));
      state.files[normalize(file)] = { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      /* skip */
    }
  }
  return state;
}

async function readSnapshot(root) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(root, SNAPSHOT_REL), 'utf8'));
    return parsed !== null && typeof parsed.files === 'object' && parsed.files !== null ? parsed : null;
  } catch {
    return null;
  }
}

async function writeSnapshot(root, files) {
  const target = path.join(root, SNAPSHOT_REL);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify({ version: 1, generatedAt: Date.now(), files }, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, target);
}

function changedPaths(previous, current) {
  const paths = new Set([...Object.keys(previous), ...Object.keys(current)]);
  const changed = [];
  for (const file of paths) {
    const before = previous[file];
    const after = current[file];
    if (before === undefined || after === undefined || before.mtimeMs !== after.mtimeMs || before.size !== after.size) changed.push(file);
  }
  return changed.sort();
}

async function snapshotChange({ cwd, fastPath }) {
  const current = (await scanTree(cwd)).files;
  const previous = await readSnapshot(cwd);
  if (previous === null) {
    await writeSnapshot(cwd, current);
    return { available: false, simple: false, reason: 'snapshot baseline created; next turn can use the fast path' };
  }
  const paths = changedPaths(previous.files, current);
  const docsOnly = paths.length > 0 && paths.every(isNonCodePath);
  const allowPaths = Array.isArray(fastPath.allowPaths) ? fastPath.allowPaths : [];
  const allowed = allowPaths.length === 0 || paths.every((file) => allowPaths.some((pattern) => matchesPath(file, pattern)));
  const maxFiles = Number.isInteger(fastPath.maxFiles) ? fastPath.maxFiles : 10;
  const withinFiles = paths.length <= maxFiles;
  const simple = paths.length > 0 && withinFiles && (docsOnly || allowed);
  await writeSnapshot(cwd, current);
  return {
    available: true,
    simple,
    reason: simple ? (docsOnly ? 'documentation-only change (snapshot)' : 'small scoped change (snapshot)') : 'change exceeds snapshot fast-path limits',
    docsOnly,
    allowed,
    files: paths.length,
    lines: 0,
    paths,
    source: 'snapshot',
    selected: simple && Array.isArray(fastPath.checks) ? [...fastPath.checks] : null,
  };
}

/**
 * Classify a git diff against a project's fastPath policy.
 * Returns `{ available, simple, reason, ... }`; git errors fall back to a
 * deterministic mtime/size snapshot (first call establishes the baseline).
 */
export async function classifyChange({ cwd, fastPath, gitPath = 'git', base = 'HEAD' } = {}) {
  if (fastPath === null || typeof fastPath !== 'object' || fastPath.enabled !== true) {
    return { available: false, simple: false, reason: 'fast path is not configured' };
  }
  let diff;
  try {
    diff = await collectDiff({ cwd, gitPath, base });
  } catch {
    return snapshotChange({ cwd, fastPath });
  }
  const files = diff.files;
  const paths = files.map((file) => file.path);
  const docsOnly = paths.length > 0 && paths.every(isNonCodePath);
  const allowPaths = Array.isArray(fastPath.allowPaths) ? fastPath.allowPaths : [];
  const allowed = allowPaths.length === 0 || paths.every((file) => allowPaths.some((pattern) => matchesPath(file, pattern)));
  const maxFiles = Number.isInteger(fastPath.maxFiles) ? fastPath.maxFiles : 10;
  const maxLines = Number.isInteger(fastPath.maxLines) ? fastPath.maxLines : 80;
  const withinFiles = diff.totals.files <= maxFiles;
  const withinLines = diff.totals.lines <= maxLines;
  const noChanges = paths.length === 0;
  const simple = (docsOnly && withinFiles) || (withinFiles && withinLines && allowed && paths.length > 0);
  const reason = simple
    ? (docsOnly ? 'documentation-only change' : 'small scoped change')
    : noChanges
      ? 'no change detected'
      : `change exceeds fast-path limits (files ${diff.totals.files}/${maxFiles}, lines ${diff.totals.lines}/${maxLines}, allowed ${allowed})`;
  return {
    available: true,
    simple,
    reason,
    docsOnly,
    allowed,
    files: diff.totals.files,
    lines: diff.totals.lines,
    paths,
    source: 'git',
    selected: simple && Array.isArray(fastPath.checks) ? [...fastPath.checks] : null,
  };
}

/** Select a subset of the project's checks for a deterministic fast path. */
export async function selectFastPath({ cwd, project, config, gitPath } = {}) {
  if (project?.fastPath === undefined || project.fastPath === null) return null;
  const classification = await classifyChange({
    cwd,
    fastPath: project.fastPath,
    gitPath: project.gitPath ?? config?.gitPath ?? config?.executables?.git ?? process.env.GIT_EXECUTABLE ?? gitPath ?? 'git',
  });
  if (!classification.available || !classification.simple || !Array.isArray(classification.selected) || classification.selected.length === 0) {
    return null;
  }
  const availableIds = new Set(Array.isArray(project.plan?.checks) ? project.plan.checks.map((check) => check.id) : []);
  const ids = classification.selected.filter((id) => availableIds.has(id));
  if (ids.length === 0) return null;
  return { ids, classification };
}
