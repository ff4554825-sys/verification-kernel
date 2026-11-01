/** Paired A/B comparison for verification outcomes, with a deterministic bootstrap CI. */

import { summarizeOutcomes } from './outcomes.js';

function keyOf(record, key) {
  const value = record?.[key] ?? record?.taskId ?? record?.task ?? record?.project;
  return value === undefined || value === null ? '' : String(value);
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Build paired records by key, falling back to position for duplicate/missing keys. */
export function pairOutcomes(control, treatment, { key = 'task' } = {}) {
  if (!Array.isArray(control) || !Array.isArray(treatment)) throw new Error('control and treatment must be arrays');
  const controlByKey = new Map();
  for (const record of control) {
    const k = keyOf(record, key);
    if (!controlByKey.has(k)) controlByKey.set(k, []);
    controlByKey.get(k).push(record);
  }
  const pairs = [];
  const used = new Map();
  for (const record of treatment) {
    const k = keyOf(record, key);
    const bucket = controlByKey.get(k) ?? [];
    const index = used.get(k) ?? 0;
    const controlRecord = bucket[index] ?? null;
    if (controlRecord !== null) used.set(k, index + 1);
    pairs.push({ key: k, control: controlRecord, treatment: record });
  }
  return pairs;
}

/**
 * Compare control vs treatment.
 * Status semantics: pass=1; fail/unknown/flaky=0. Latency/cost are reported separately.
 */
export function compareAB(control, treatment, {
  key = 'task',
  bootstrap = 2_000,
  seed = 0x5eed,
} = {}) {
  if (!Array.isArray(control) || !Array.isArray(treatment)) throw new Error('control and treatment must be arrays');
  const pairs = pairOutcomes(control, treatment, { key });
  const paired = pairs.filter((pair) => pair.control !== null);
  const controlStatus = paired.map((pair) => pair.control.status === 'pass' ? 1 : 0);
  const treatmentStatus = paired.map((pair) => pair.treatment.status === 'pass' ? 1 : 0);
  const diffs = treatmentStatus.map((value, index) => value - controlStatus[index]);
  const wins = diffs.filter((value) => value > 0).length;
  const losses = diffs.filter((value) => value < 0).length;
  const ties = diffs.filter((value) => value === 0).length;

  const random = lcg(seed);
  const bootstrapMeans = [];
  for (let round = 0; round < Math.max(1, bootstrap); round += 1) {
    const sample = [];
    for (let index = 0; index < diffs.length; index += 1) sample.push(diffs[Math.floor(random() * diffs.length)] ?? 0);
    bootstrapMeans.push(mean(sample));
  }
  bootstrapMeans.sort((a, b) => a - b);

  const controlSummary = summarizeOutcomes(control);
  const treatmentSummary = summarizeOutcomes(treatment);
  return {
    version: 1,
    key,
    generatedAt: Date.now(),
    control: controlSummary,
    treatment: treatmentSummary,
    paired: {
      total: paired.length,
      droppedControl: pairs.length - paired.length,
      treatmentCount: treatment.length,
      passRateDelta: Number((mean(treatmentStatus) - mean(controlStatus)).toFixed(4)),
      wins,
      losses,
      ties,
      latencyDeltaMs: Number((treatmentSummary.latencyMs.p50 - controlSummary.latencyMs.p50).toFixed(1)),
      costDeltaMs: Number((treatmentSummary.cost.avgMs - controlSummary.cost.avgMs).toFixed(1)),
      bootstrapMeanDelta: {
        low: Number(percentile(bootstrapMeans, 0.025).toFixed(4)),
        high: Number(percentile(bootstrapMeans, 0.975).toFixed(4)),
        rounds: Math.max(1, bootstrap),
        seed,
      },
    },
    note: 'Paired A/B; pass/fail/unknown/flaky are observed outcomes, not model IQ. Bootstrap CI is deterministic for this seed.',
  };
}
