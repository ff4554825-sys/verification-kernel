/** Local documentation knowledge base backed by SQLite FTS5 (Node 22+). */

import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { policyScore, readPolicy } from './local-learner.js';

const VERSION = 1;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.dsh', 'tools', 'dist', 'build', 'coverage']);
const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.rst', '.txt', '.adoc', '.asciidoc']);
const MAX_FILES = 2_000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_CHUNK_CHARS = 1_600;

function normalize(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

async function walkDocs(root, options, state) {
  if (state.files.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await fs.readdir(path.join(root, state.relative), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (state.files.length >= MAX_FILES) break;
    if (entry.name.startsWith('.') && SKIP_DIRS.has(entry.name)) continue;
    const relative = state.relative === '' ? entry.name : `${state.relative}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkDocs(root, options, { ...state, relative });
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!DOC_EXTENSIONS.has(extension) && !(entry.name === 'AGENTS.md' && options.includeAgents !== false)) continue;
    state.files.push(relative);
  }
}

function cjkBigrams(text) {
  const tokens = [];
  for (const match of text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu)) {
    const run = match[0];
    for (let index = 0; index < run.length; index += 1) {
      tokens.push(run[index]);
      if (index + 1 < run.length) tokens.push(run.slice(index, index + 2));
    }
  }
  return tokens;
}

function latinTokens(text) {
  return [...text.toLowerCase().matchAll(/[\p{L}][\p{L}\p{N}_-]+/gu)].map((match) => match[0]);
}

function queryExpression(query) {
  const terms = [...new Set(latinTokens(query))];
  const cjk = [...new Set(cjkBigrams(query))];
  const groups = [];
  for (const term of [...terms, ...cjk]) {
    const escaped = term.replace(/"/g, '""');
    groups.push(`(content:"${escaped}" OR cjk:"${escaped}")`);
  }
  return groups.join(' AND ');
}

function splitIntoChunks(text, filePath) {
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let current = [];
  let start = 1;
  let size = 0;
  const flush = (end) => {
    const body = current.join('\n').trim();
    if (body !== '') {
      const heading = current.find((line) => /^#{1,6}\s+/.test(line))?.replace(/^#{1,6}\s+/, '').trim() ?? '';
      chunks.push({ path: filePath, title: heading || path.basename(filePath), content: body, startLine: start, endLine: end });
    }
    current = [];
    size = 0;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (current.length > 0 && size + line.length + 1 > MAX_CHUNK_CHARS) {
      flush(index);
      start = index + 1;
    }
    current.push(line);
    size += line.length + 1;
  }
  flush(lines.length);
  return chunks;
}

async function scan(root, options = {}) {
  const state = { relative: '', files: [] };
  await walkDocs(root, options, state);
  const chunks = [];
  const stats = [];
  for (const file of state.files) {
    const absolute = path.join(root, file);
    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      const text = await fs.readFile(absolute, 'utf8');
      stats.push({ path: file, mtimeMs: stat.mtimeMs, size: stat.size });
      chunks.push(...splitIntoChunks(text, file));
    } catch {
      /* skip unreadable files */
    }
  }
  return { files: stats, chunks };
}

function signature(files) {
  return files.map((file) => `${file.path}:${file.mtimeMs}:${file.size}`).join('|');
}

function dbPathFor(root) {
  return path.join(root, '.dsh', 'knowledge', 'knowledge.db');
}

/** Build or refresh the local FTS5 index. */
export async function indexKnowledge({ root = process.cwd(), force = false } = {}) {
  const absoluteRoot = path.resolve(root);
  const records = await scan(absoluteRoot);
  const dbPath = dbPathFor(absoluteRoot);
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(path, title, content, cjk, startLine UNINDEXED, endLine UNINDEXED, tokenize=\'unicode61\')');
    const previous = db.prepare("SELECT value FROM meta WHERE key = 'signature'").get();
    const previousRoot = db.prepare("SELECT value FROM meta WHERE key = 'root'").get();
    const nextSignature = signature(records.files);
    if (!force && previous?.value === nextSignature && previousRoot?.value === absoluteRoot) {
      const count = db.prepare('SELECT COUNT(*) AS n FROM docs').get()?.n ?? 0;
      return { root: absoluteRoot, dbPath, files: records.files.length, chunks: count, rebuilt: false };
    }
    db.exec('BEGIN');
    db.exec('DELETE FROM docs');
    const insert = db.prepare('INSERT INTO docs(path, title, content, cjk, startLine, endLine) VALUES (?, ?, ?, ?, ?, ?)');
    for (const chunk of records.chunks) insert.run(chunk.path, chunk.title, chunk.content, cjkBigrams(`${chunk.title}\n${chunk.content}`).join(' '), chunk.startLine, chunk.endLine);
    db.prepare("INSERT INTO meta(key, value) VALUES ('signature', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(nextSignature);
    db.prepare("INSERT INTO meta(key, value) VALUES ('root', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(absoluteRoot);
    db.prepare("INSERT INTO meta(key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(VERSION));
    db.prepare("INSERT INTO meta(key, value) VALUES ('generatedAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(Date.now()));
    db.exec('COMMIT');
    return { root: absoluteRoot, dbPath, files: records.files.length, chunks: records.chunks.length, rebuilt: true };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  } finally {
    db.close();
  }
}

/** Search the local documentation index, refreshing it when source files changed. */
export async function searchKnowledge({ root = process.cwd(), query, limit = 5 } = {}) {
  if (typeof query !== 'string' || query.trim() === '') throw new Error('query is required');
  const absoluteRoot = path.resolve(root);
  const index = await indexKnowledge({ root: absoluteRoot });
  const expression = queryExpression(query);
  if (expression === '') return { ...index, query, results: [] };
  const requested = Math.max(1, Math.min(20, Number(limit) || 5));
  const policy = await readPolicy(path.join(absoluteRoot, '.dsh', 'learning', 'retrieval-policy.json'));
  const hasPolicy = Object.keys(policy.weights).length > 0;
  const queryTerms = [...new Set([...latinTokens(query), ...cjkBigrams(query)])];
  const db = new DatabaseSync(index.dbPath, { readOnly: true });
  try {
    const rows = db.prepare(`
      SELECT path, title, startLine, endLine,
             snippet(docs, 2, '<mark>', '</mark>', '…', 20) AS snippet,
             bm25(docs) AS score
      FROM docs WHERE docs MATCH ? ORDER BY score LIMIT ?
    `).all(expression, Math.min(60, requested * 3));
    const results = rows.map((row) => {
      const keys = [`doc:${row.path}`, ...queryTerms.map((term) => `term:${term}`)];
      const learnedBoost = hasPolicy ? policyScore(policy, keys) : 0;
      return {
        path: row.path,
        title: row.title,
        startLine: row.startLine,
        endLine: row.endLine,
        snippet: row.snippet,
        score: row.score,
        learnedBoost,
        adjustedScore: Number((row.score - learnedBoost).toFixed(6)),
      };
    });
    if (hasPolicy) results.sort((a, b) => a.adjustedScore - b.adjustedScore);
    return {
      ...index,
      query,
      policyPath: path.join(absoluteRoot, '.dsh', 'learning', 'retrieval-policy.json'),
      results: results.slice(0, requested),
    };
  } finally {
    db.close();
  }
}

export const KNOWLEDGE_LIMITS = { MAX_FILES, MAX_FILE_BYTES, MAX_CHUNK_CHARS };
