/**
 * Pre-execution policy for tool calls.
 *
 * The turn gate judges after the fact: by the time it runs, `rm -rf` has already
 * happened. DSH exposes `agentCtx.tools.guard(fn)`, which runs before dispatch
 * and can return a denial string — the same slot as Claude Code's PreToolUse.
 *
 * The guard is **synchronous** (`dsh-tools/lib/index.js:771` calls `guard(exec)`
 * and uses the return value immediately), so it cannot run a check plan. What it
 * can do is match the invocation against rules: that is also most of what a
 * PreToolUse hook is used for in practice.
 */

/**
 * @param raw - untrusted `preTool` config.
 * @param warnings - collector for validation messages.
 * @returns `{ enabled, rules }`, or null when the feature is off.
 */
export function normalizePreTool(raw, warnings = []) {
  if (raw === undefined) return null;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push('preTool must be an object');
    return null;
  }
  if (raw.enabled !== true) return null;
  const rules = [];
  for (const [index, entry] of (Array.isArray(raw.rules) ? raw.rules : []).entries()) {
    const where = `preTool.rules[${index}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      warnings.push(`${where} must be an object`);
      continue;
    }
    const id = typeof entry.id === 'string' && entry.id.trim() !== '' ? entry.id.trim() : `rule-${index + 1}`;
    const reason = typeof entry.reason === 'string' && entry.reason.trim() !== ''
      ? entry.reason.trim()
      : `denied by pre-tool rule '${id}'`;
    if (typeof entry.pattern !== 'string' || entry.pattern === '') {
      warnings.push(`${where}.pattern must be a non-empty string`);
      continue;
    }
    let regex;
    try {
      regex = new RegExp(entry.pattern, 'i');
    } catch {
      warnings.push(`${where}.pattern is not a valid regular expression`);
      continue;
    }
    const tools = Array.isArray(entry.tools) ? entry.tools.filter((name) => typeof name === 'string' && name !== '') : [];
    rules.push({ id, reason, regex, tools });
  }
  return { enabled: true, rules };
}

/** The text a rule is matched against: whatever the invocation actually carries. */
export function invocationText(exec) {
  if (exec === null || typeof exec !== 'object') return '';
  const candidate = exec.tool_input ?? exec.input ?? exec.args ?? exec.arguments ?? null;
  if (candidate !== null && typeof candidate === 'object') {
    try {
      return JSON.stringify(candidate);
    } catch {
      return '';
    }
  }
  if (typeof candidate === 'string') return candidate;
  return '';
}

/** Tool name from whichever field the host used. */
export function invocationTool(exec) {
  if (exec === null || typeof exec !== 'object') return '';
  if (typeof exec.name === 'string') return exec.name;
  if (typeof exec.toolName === 'string') return exec.toolName;
  if (exec.tool !== null && typeof exec.tool === 'object' && typeof exec.tool.name === 'string') return exec.tool.name;
  return '';
}

/**
 * Decide whether one invocation is denied.
 * @param config - output of normalizePreTool.
 * @param exec - the host's invocation object.
 * @returns `{ denied, ruleId, reason }`.
 */
export function evaluatePreTool(config, exec) {
  if (config === null || config === undefined || config.enabled !== true) {
    return { denied: false, ruleId: null, reason: '' };
  }
  const tool = invocationTool(exec);
  const text = invocationText(exec);
  for (const rule of config.rules ?? []) {
    if (rule.tools.length > 0 && !rule.tools.includes(tool)) continue;
    if (!rule.regex.test(text)) continue;
    return { denied: true, ruleId: rule.id, reason: rule.reason };
  }
  return { denied: false, ruleId: null, reason: '' };
}
