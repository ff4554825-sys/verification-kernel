/** Best-effort secret redaction for evidence. Not a substitute for a secret scanner. */

const RULES = [
  { pattern: /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, replacement: '$1[REDACTED]' },
  { pattern: /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|authorization)\s*[:=]\s*)([^\s"'`]+)/gi, replacement: '$1[REDACTED]' },
  { pattern: /\bsk-[A-Za-z0-9_-]{10,}\b/g, replacement: '[REDACTED]' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replacement: '[REDACTED]' },
];

export function redactSensitive(text) {
  if (typeof text !== 'string' || text === '') return '';
  let output = text;
  for (const rule of RULES) output = output.replace(rule.pattern, rule.replacement);
  return output;
}
