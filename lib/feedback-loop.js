/** Automatic, weakly-attributed feedback from verification outcomes to local retrieval policy.
 *
 * Attribution is deliberately explicit: a retrieval event is linked to the next
 * verification outcome for the same project/agent inside a time window. That is
 * correlation, not proof that the document caused the outcome. Updates use a
 * small learning rate and are marked `weak-retrieval-window`.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readPolicy, updatePolicy, writePolicy } from './local-learner.js';

const RETRIEVAL_REL = path.join('.dsh', 'learning', 'retrievals.jsonl');
const ATTRIBUTION_REL = path.join('.dsh', 'learning', 'attributions.jsonl');
const POLICY_REL = path.join('.dsh', 'learning', 'retrieval-policy.json');
const DEFAULT_WINDOW_MS = 2 * 60 * 60 * 1000;
const DEFAULT_TOP = 3;

function paths(root) {
  const absolute = path.resolve(root);
  return {
    root: absolute,
    retrieval: path.join(absolute, RETRIEVAL_REL),
    attribution: path.join(absolute, ATTRIBUTION_REL),
    policy: path.join(absolute, POLICY_REL),
  };
}

async function readJsonl(file) {
  try {
    const text = await fs.readFile(file, 'utf8');
    const records = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === '') continue;
      try {
        const value = JSON.parse(line);
        if (value !== null && typeof value === 'object') records.push(value);
      } catch {
        /* ignore corrupt lines */
      }
    }
    return records;
  } catch {
    return [];
  }
}

async function appendJsonl(file, record) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
}

async function writeRetrievals(file, records) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temporary, records.map((record) => JSON.stringify(record)).join('\n') + (records.length === 0 ? '' : '\n'), 'utf8');
  await fs.rename(temporary, file);
}

/** Record a knowledge_search result for later weak attribution. */
export async function recordRetrieval({ root, project, agentId = null, sessionId = null, query, results, now = Date.now() } = {}) {
  if (typeof query !== 'string' || query === '') throw new Error('query is required');
  if (!Array.isArray(results)) throw new Error('results must be an array');
  const target = paths(root);
  const event = {
    id: randomUUID(),
    at: now,
    project: project ?? 'unknown',
    agentId,
    sessionId,
    query,
    results: results.slice(0, 10).map((result, index) => ({
      path: result.path,
      rank: index + 1,
      score: Number.isFinite(result.score) ? result.score : 0,
      learnedBoost: Number.isFinite(result.learnedBoost) ? result.learnedBoost : 0,
    })),
  };
  await appendJsonl(target.retrieval, event);
  return event;
}

/**
 * Attribute pending retrievals to a verification outcome and update the local
 * policy. Only pass/fail have a reward; unknown/flaky do not teach.
 */
export async function attributeOutcome({
  root,
  project,
  agentId = null,
  status,
  now = Date.now(),
  windowMs = DEFAULT_WINDOW_MS,
  top = DEFAULT_TOP,
  eta = 0.01,
  maxStep = 0.02,
} = {}) {
  const target = paths(root);
  const reward = status === 'pass' ? 1 : status === 'fail' ? -1 : 0;
  const events = await readJsonl(target.retrieval);
  const eligible = events.filter((event) => {
    if (event.attributedAt !== undefined) return false;
    if (project !== undefined && project !== null && event.project !== project) return false;
    if (agentId !== null && agentId !== undefined && event.agentId !== agentId) return false;
    const age = now - (Number.isFinite(event.at) ? event.at : now);
    return age >= 0 && age <= windowMs && Array.isArray(event.results) && event.results.length > 0;
  });
  if (eligible.length === 0) {
    return { updated: false, reason: 'no pending retrieval in the attribution window', keys: [] };
  }
  if (reward === 0) {
    // Consume the pending retrievals anyway: a later pass/fail must not learn
    // from an earlier unknown/flaky turn.
    for (const event of eligible) {
      event.attributedAt = now;
      event.outcomeStatus = status;
      event.attribution = 'no-signal';
    }
    await writeRetrievals(target.retrieval, events);
    await appendJsonl(target.attribution, {
      at: now,
      project: project ?? 'unknown',
      agentId,
      status,
      attribution: 'no-signal',
      events: eligible.map((event) => ({ id: event.id, query: event.query })),
      updates: [],
    });
    return { updated: false, reason: 'outcome has no learning signal; retrievals consumed', keys: [] };
  }

  let policy = await readPolicy(target.policy);
  const updates = [];
  for (const event of eligible) {
    const chosen = event.results.slice(0, Math.max(1, Math.min(10, top)));
    for (const result of chosen) {
      if (typeof result.path !== 'string' || result.path === '') continue;
      const key = `doc:${result.path}`;
      const pre = 1 / Math.max(1, Number(result.rank) || 1);
      const applied = updatePolicy(policy, { key, pre, post: 1, reward }, { eta, maxStep });
      policy = applied.policy;
      updates.push({ key, delta: applied.delta, weight: applied.weight, eventId: event.id });
    }
    event.attributedAt = now;
    event.outcomeStatus = status;
    event.attribution = 'weak-retrieval-window';
  }
  await writePolicy(target.policy, policy);
  await writeRetrievals(target.retrieval, events);
  await appendJsonl(target.attribution, {
    at: now,
    project: project ?? 'unknown',
    agentId,
    status,
    attribution: 'weak-retrieval-window',
    events: eligible.map((event) => ({ id: event.id, query: event.query, results: event.results.map((result) => result.path) })),
    updates,
  });
  return {
    updated: updates.length > 0,
    attribution: 'weak-retrieval-window',
    status,
    events: eligible.length,
    keys: updates.map((update) => update.key),
    updates,
  };
}
