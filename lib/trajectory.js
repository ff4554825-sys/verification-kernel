/** Heuristic trajectory critic: loops, repeated calls, failures, and step volume. */

function textOf(message) {
  if (typeof message?.text === 'string') return message.text;
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
}

function resultLooksLikeError(event) {
  const message = event?.data?.message;
  if (message?.isError === true || message?.error !== undefined) return true;
  if (event?.data?.isError === true || event?.data?.error !== undefined) return true;
  const text = textOf(message);
  return /^(?:Error|error):/m.test(text)
    || /(?:^|\n)(?:Error|error):\s/.test(text)
    || /command not found|access denied|permission denied|timed out|exit code [1-9]/i.test(text);
}

/**
 * Analyze session events. The score is advisory (0-100); it never replaces
 * deterministic checks.
 */
export function analyzeTrajectory(events) {
  const calls = [];
  const results = new Map();
  let steps = 0;
  let assistantMessages = 0;
  let consecutiveFailures = 0;
  let maxConsecutiveFailures = 0;
  const failedSignatures = new Set();
  let repeatedAfterFailure = 0;
  let failedResults = 0;

  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type === 'step/end') steps += 1;
    if (event?.type === 'assistant/message') assistantMessages += 1;
    if (event?.type === 'tool/call') {
      const name = String(event.data?.name ?? '');
      const args = String(event.data?.arguments ?? '');
      const signature = `${name}\u0000${args}`;
      if (failedSignatures.has(signature)) repeatedAfterFailure += 1;
      calls.push({ name, args, signature, callId: event.data?.callId });
    }
    if (event?.type === 'tool/result') {
      const callId = event.data?.message?.toolCallId ?? event.data?.toolCallId;
      const error = resultLooksLikeError(event);
      results.set(callId, error);
      if (error) {
        failedResults += 1;
        consecutiveFailures += 1;
        if (consecutiveFailures > maxConsecutiveFailures) maxConsecutiveFailures = consecutiveFailures;
        const call = calls.find((item) => item.callId === callId);
        if (call !== undefined) failedSignatures.add(call.signature);
      } else {
        consecutiveFailures = 0;
      }
    }
  }

  const counts = new Map();
  for (const call of calls) counts.set(call.signature, (counts.get(call.signature) ?? 0) + 1);
  const maxRepeated = counts.size === 0 ? 0 : Math.max(...counts.values());
  const repeatedCalls = [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const uniqueCalls = counts.size;
  const reasons = [];
  let score = 0;
  if (repeatedCalls > 0) {
    score += Math.min(30, repeatedCalls * 5);
    reasons.push(`${repeatedCalls} repeated tool call${repeatedCalls === 1 ? '' : 's'}`);
  }
  if (maxRepeated > 1) {
    score += Math.min(25, (maxRepeated - 1) * 10);
    reasons.push(`one call repeated ${maxRepeated} times`);
  }
  if (failedResults > 0) {
    score += Math.min(20, failedResults * 3);
    reasons.push(`${failedResults} failed tool result${failedResults === 1 ? '' : 's'}`);
  }
  if (maxConsecutiveFailures > 1) {
    score += Math.min(15, maxConsecutiveFailures * 5);
    reasons.push(`${maxConsecutiveFailures} consecutive failures`);
  }
  if (repeatedAfterFailure > 0) {
    score += Math.min(10, repeatedAfterFailure * 5);
    reasons.push(`${repeatedAfterFailure} repeat${repeatedAfterFailure === 1 ? '' : 's'} after a failed call`);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const severity = score >= 60 ? 'high' : score >= 25 ? 'warn' : 'ok';
  return {
    score,
    severity,
    reasons,
    metrics: {
      steps,
      assistantMessages,
      toolCalls: calls.length,
      uniqueCalls,
      repeatedCalls,
      maxRepeated,
      failedResults,
      maxConsecutiveFailures,
      repeatedAfterFailure,
    },
  };
}

export function formatCritic(report) {
  const lines = [
    `Trajectory critic: ${report.score}/100 (${report.severity})`,
    `Tools: ${report.metrics.toolCalls} calls · ${report.metrics.uniqueCalls} unique · ${report.metrics.repeatedCalls} repeated`,
    `Failures: ${report.metrics.failedResults} · max consecutive ${report.metrics.maxConsecutiveFailures}`,
    `Steps: ${report.metrics.steps} · assistant messages ${report.metrics.assistantMessages}`,
  ];
  if (report.reasons.length > 0) lines.push(`Reasons: ${report.reasons.join('; ')}`);
  lines.push('Advisory only: do not use this score as a pass/fail substitute.');
  return lines.join('\n');
}
