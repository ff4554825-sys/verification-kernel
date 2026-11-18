/** Outcome calibration: per-check reliability, latency, and safe recommendations. */

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function round(value, digits = 1) {
  return Number(value.toFixed(digits));
}

/**
 * Analyze outcome records and recommend checks for stabilization or a fast path.
 * This is advisory: it never edits project configuration or weakens a required check.
 */
export function calibrateOutcomes(records, {
  minRuns = 5,
  flakyThreshold = 0.1,
  unknownThreshold = 0.1,
  slowP95Ms = 60_000,
  fastP95Ms = 5_000,
} = {}) {
  if (!Array.isArray(records)) throw new Error('records must be an array');
  const projects = {};
  const recommendations = [];
  let recordsWithDetails = 0;

  for (const record of records) {
    const project = typeof record.project === 'string' && record.project !== '' ? record.project : 'unknown';
    const bucket = projects[project] ?? { runs: 0, statuses: { pass: 0, fail: 0, unknown: 0, flaky: 0 }, durations: [], checks: {} };
    bucket.runs += 1;
    if (Object.hasOwn(bucket.statuses, record.status)) bucket.statuses[record.status] += 1;
    const duration = Number.isFinite(record.durationMs) ? Math.max(0, record.durationMs) : 0;
    bucket.durations.push(duration);

    if (Array.isArray(record.checksDetail) && record.checksDetail.length > 0) {
      recordsWithDetails += 1;
      for (const detail of record.checksDetail) {
        if (detail === null || typeof detail !== 'object' || typeof detail.id !== 'string' || detail.id === '') continue;
        const check = bucket.checks[detail.id] ?? {
          runs: 0,
          statuses: { pass: 0, fail: 0, unknown: 0, flaky: 0 },
          durations: [],
          retries: 0,
          required: detail.required === true,
        };
        check.runs += 1;
        if (Object.hasOwn(check.statuses, detail.status)) check.statuses[detail.status] += 1;
        check.durations.push(Number.isFinite(detail.durationMs) ? Math.max(0, detail.durationMs) : 0);
        check.retries += Math.max(0, (Number.isInteger(detail.attempts) ? detail.attempts : 1) - 1);
        check.required = check.required || detail.required === true;
        bucket.checks[detail.id] = check;
      }
    }
    projects[project] = bucket;
  }

  for (const [project, bucket] of Object.entries(projects)) {
    for (const [id, check] of Object.entries(bucket.checks)) {
      const flakyRate = check.runs === 0 ? 0 : check.statuses.flaky / check.runs;
      const unknownRate = check.runs === 0 ? 0 : check.statuses.unknown / check.runs;
      const failureRate = check.runs === 0 ? 0 : check.statuses.fail / check.runs;
      const p95 = percentile(check.durations, 0.95);
      if (check.runs >= minRuns && flakyRate >= flakyThreshold) {
        recommendations.push({
          type: 'stabilize',
          project,
          check: id,
          reason: `flaky rate ${round(flakyRate * 100)}% over ${check.runs} runs`,
          action: 'increase retries or quarantine before making it a fast-path check',
        });
      }
      if (check.runs >= minRuns && unknownRate >= unknownThreshold) {
        recommendations.push({
          type: 'investigate-unknown',
          project,
          check: id,
          reason: `unknown rate ${round(unknownRate * 100)}% over ${check.runs} runs`,
          action: 'fix environment/timeout before trusting this check',
        });
      }
      if (check.runs >= minRuns && p95 >= slowP95Ms) {
        recommendations.push({
          type: 'slow-check',
          project,
          check: id,
          reason: `p95 ${p95}ms exceeds ${slowP95Ms}ms`,
          action: 'split the check or move it out of the fast path',
        });
      }
      if (check.runs >= minRuns && check.required && failureRate === 0 && flakyRate === 0 && p95 <= fastP95Ms) {
        recommendations.push({
          type: 'fast-candidate',
          project,
          check: id,
          reason: `stable ${check.runs} runs, p95 ${p95}ms`,
          action: 'candidate for project.fastPath.checks; review before enabling',
        });
      }
    }
  }

  const summary = {};
  for (const [project, bucket] of Object.entries(projects)) {
    const statuses = bucket.statuses;
    summary[project] = {
      runs: bucket.runs,
      passRate: bucket.runs === 0 ? 0 : round(statuses.pass / bucket.runs, 4),
      failures: statuses.fail,
      unknowns: statuses.unknown,
      flaky: statuses.flaky,
      p95Ms: percentile(bucket.durations, 0.95),
      checks: Object.fromEntries(Object.entries(bucket.checks).map(([id, check]) => [id, {
        runs: check.runs,
        required: check.required,
        pass: check.statuses.pass,
        fail: check.statuses.fail,
        unknown: check.statuses.unknown,
        flaky: check.statuses.flaky,
        retries: check.retries,
        p95Ms: percentile(check.durations, 0.95),
      }])),
    };
  }

  return {
    version: 1,
    generatedAt: Date.now(),
    totalRecords: records.length,
    recordsWithCheckDetails: recordsWithDetails,
    minRuns,
    thresholds: { flakyThreshold, unknownThreshold, slowP95Ms, fastP95Ms },
    projects: summary,
    recommendations,
    note: 'Advisory only; calibration never edits project config or disables a required check.',
  };
}
