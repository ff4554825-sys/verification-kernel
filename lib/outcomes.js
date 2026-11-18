/** Append-only verification outcome store and cost/latency summary. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { hashValue } from './kernel.js';

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

/** Convert a verdict into a compact, append-only outcome record. */
export function outcomeFromVerdict(verdict, meta = {}) {
  if (verdict === null || typeof verdict !== 'object') throw new Error('verdict is required');
  const checks = Array.isArray(verdict.checks) ? verdict.checks : [];
  const checkMs = checks.reduce((sum, check) => sum + (Number.isFinite(check.durationMs) ? check.durationMs : 0), 0);
  const retries = checks.reduce((sum, check) => sum + Math.max(0, (check.attempts ?? 1) - 1), 0);
  const required = checks.filter((check) => check.required);
  return {
    version: 1,
    recordedAt: Date.now(),
    project: typeof meta.project === 'string' && meta.project !== '' ? meta.project : (verdict.id ?? 'verification'),
    status: verdict.status ?? 'unknown',
    reason: verdict.reason ?? '',
    planHash: verdict.planHash ?? '',
    isolation: verdict.isolation ?? meta.isolation ?? 'host',
    durationMs: Number.isFinite(verdict.durationMs) ? verdict.durationMs : 0,
    checks: checks.length,
    requiredFailed: required.filter((check) => check.status === 'fail').length,
    requiredUnknown: required.filter((check) => check.status === 'unknown').length,
    requiredFlaky: required.filter((check) => check.status === 'flaky').length,
    unknownReasons: verdict.unknownReasons ?? {},
    coverage: verdict.coverage === undefined
      ? null
      : {
          planned: verdict.coverage.planned,
          ran: verdict.coverage.ran,
          skipped: Array.isArray(verdict.coverage.skipped) ? verdict.coverage.skipped.length : 0,
          partial: verdict.coverage.partial === true,
        },
    retries,
    cost: {
      checkMs,
      overheadMs: Math.max(0, (Number.isFinite(verdict.durationMs) ? verdict.durationMs : 0) - checkMs),
      retries,
    },
    checksDetail: checks.map((check) => ({
      id: check.id,
      required: check.required === true,
      status: check.status,
      ...(check.status === 'unknown' && typeof check.reason === 'string' ? { reason: check.reason } : {}),
      durationMs: Number.isFinite(check.durationMs) ? Math.max(0, check.durationMs) : 0,
      attempts: Number.isInteger(check.attempts) ? check.attempts : 1,
    })),
    evidenceHash: hashValue(verdict),
    ...(verdict.fastPath === undefined ? {} : { fastPath: verdict.fastPath }),
    ...(verdict.advisor === undefined ? {} : { advisor: verdict.advisor }),
    ...(typeof meta.artifactPath === 'string' && meta.artifactPath !== '' ? { artifactPath: meta.artifactPath } : {}),
  };
}

/** Append one JSONL record; returns the record. */
export async function appendOutcome(storePath, record) {
  const absolute = path.resolve(storePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.appendFile(absolute, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

/** Read JSONL records, ignoring corrupt lines. */
export async function readOutcomes(storePath) {
  let text;
  try {
    text = await fs.readFile(path.resolve(storePath), 'utf8');
  } catch {
    return [];
  }
  const records = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      const record = JSON.parse(line);
      if (record !== null && typeof record === 'object' && typeof record.status === 'string') records.push(record);
    } catch {
      /* keep the valid records */
    }
  }
  return records;
}

/** Aggregate pass rate, latency percentiles, and cost proxies. */
export function summarizeOutcomes(records) {
  if (!Array.isArray(records)) throw new Error('records must be an array');
  const counts = { pass: 0, fail: 0, unknown: 0, flaky: 0 };
  const durations = [];
  const costs = [];
  const byProject = {};
  for (const record of records) {
    if (Object.hasOwn(counts, record.status)) counts[record.status] += 1;
    const duration = Number.isFinite(record.durationMs) ? Math.max(0, record.durationMs) : 0;
    durations.push(duration);
    const cost = record.cost !== null && typeof record.cost === 'object'
      ? (Number.isFinite(record.cost.checkMs) ? record.cost.checkMs : 0) + (Number.isFinite(record.cost.overheadMs) ? record.cost.overheadMs : 0)
      : duration;
    costs.push(cost);
    const project = typeof record.project === 'string' ? record.project : 'unknown';
    const bucket = byProject[project] ?? { total: 0, pass: 0, fail: 0, unknown: 0, flaky: 0, durationMs: 0 };
    bucket.total += 1;
    if (Object.hasOwn(bucket, record.status)) bucket[record.status] += 1;
    bucket.durationMs += duration;
    byProject[project] = bucket;
  }
  const sorted = [...durations].sort((a, b) => a - b);
  const total = records.length;
  return {
    total,
    counts,
    passRate: total === 0 ? 0 : Number((counts.pass / total).toFixed(4)),
    unknownRate: total === 0 ? 0 : Number((counts.unknown / total).toFixed(4)),
    latencyMs: {
      avg: total === 0 ? 0 : Number((durations.reduce((a, b) => a + b, 0) / total).toFixed(1)),
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      max: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
    },
    cost: {
      totalMs: Number(costs.reduce((a, b) => a + b, 0).toFixed(1)),
      avgMs: total === 0 ? 0 : Number((costs.reduce((a, b) => a + b, 0) / total).toFixed(1)),
      retries: records.reduce((sum, record) => sum + (Number.isInteger(record.retries) ? record.retries : 0), 0),
      note: 'cost is a deterministic check-time proxy, not tokens or money',
    },
    byProject,
  };
}
