/** Verifier metrics derived from the JSONL trace written by artifacts.js. */

import fs from 'node:fs/promises';

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

/** Summarize trace events produced by writeVerdictArtifacts. */
export function summarizeEvents(events) {
  const byStatus = { pass: 0, fail: 0, unknown: 0, flaky: 0, other: 0 };
  const durations = [];
  let flakyChecks = 0;
  let overrides = 0;
  let checkRuns = 0;
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue;
    const status = typeof event.status === 'string' ? event.status : 'other';
    if (Object.hasOwn(byStatus, status)) byStatus[status] += 1;
    else byStatus.other += 1;
    if (Number.isFinite(event.durationMs)) durations.push(Math.max(0, event.durationMs));
    if (event.override !== undefined) overrides += 1;
    if (Array.isArray(event.checks)) {
      checkRuns += event.checks.length;
      for (const check of event.checks) {
        if (check?.status === 'flaky') flakyChecks += 1;
      }
    }
  }
  durations.sort((left, right) => left - right);
  const total = events.filter((event) => event !== null && typeof event === 'object').length;
  const passed = byStatus.pass;
  return {
    total,
    byStatus,
    checkRuns,
    flakyChecks,
    overrides,
    durationMs: {
      avg: durations.length === 0 ? 0 : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
      p50: Math.round(percentile(durations, 50)),
      p95: Math.round(percentile(durations, 95)),
      max: durations.length === 0 ? 0 : Math.round(durations[durations.length - 1]),
    },
    passRate: total === 0 ? 0 : Number((passed / total).toFixed(4)),
  };
}

export async function readTrace(tracePath) {
  let text;
  try {
    text = await fs.readFile(tracePath, 'utf8');
  } catch {
    return [];
  }
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* skip a corrupt trace line */
    }
  }
  return events;
}

export async function summarizeTrace(tracePath) {
  return summarizeEvents(await readTrace(tracePath));
}

export function formatSummary(summary) {
  const lines = [
    `Verifier runs: ${summary.total}`,
    `Verdicts: pass ${summary.byStatus.pass} · fail ${summary.byStatus.fail} · unknown ${summary.byStatus.unknown} · flaky ${summary.byStatus.flaky} · other ${summary.byStatus.other}`,
    `Pass rate: ${(summary.passRate * 100).toFixed(1)}%`,
    `Checks: ${summary.checkRuns} runs · flaky ${summary.flakyChecks} · overrides ${summary.overrides}`,
    `Latency: avg ${summary.durationMs.avg}ms · p50 ${summary.durationMs.p50}ms · p95 ${summary.durationMs.p95}ms · max ${summary.durationMs.max}ms`,
  ];
  return lines.join('\n');
}
