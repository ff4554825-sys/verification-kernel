/** Export verification trace JSONL to an eval-friendly JSON document. */

import fs from 'node:fs/promises';
import { readTrace, summarizeEvents } from './report.js';

export function exportRuns(events, { generatedAt = new Date().toISOString() } = {}) {
  const runs = events
    .filter((event) => event !== null && typeof event === 'object')
    .map((event) => ({
      id: event.id,
      status: event.status,
      reason: event.reason,
      durationMs: event.durationMs,
      counts: event.counts,
      checks: Array.isArray(event.checks) ? event.checks : [],
      planHash: event.planHash,
      hashes: event.hashes,
      ...(event.override === undefined ? {} : { override: event.override }),
      time: event.time,
    }));
  return {
    format: 'dsh-verification-trace',
    version: 1,
    generatedAt,
    runs,
    metrics: summarizeEvents(events),
  };
}

export async function exportTraceFile(tracePath, options = {}) {
  const events = await readTrace(tracePath);
  return exportRuns(events, options);
}

export async function writeExport(tracePath, outputPath, options = {}) {
  const document = await exportTraceFile(tracePath, options);
  await fs.writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return { outputPath, document };
}
