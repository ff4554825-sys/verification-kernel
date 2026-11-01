import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGitleaks, normalizeSemgrep, normalizeTrivy } from '../lib/security.js';

test('normalizeGitleaks maps findings to high severity', () => {
  const findings = normalizeGitleaks({
    findings: [{ RuleID: 'generic-api-key', File: 'a.js', StartLine: 3, Description: 'key', Secret: 'redacted' }],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tool, 'gitleaks');
  assert.equal(findings[0].severity, 'high');
  assert.equal(findings[0].file, 'a.js');
  assert.equal(findings[0].line, 3);
});

test('normalizeSemgrep maps ERROR to high and WARNING to medium', () => {
  const findings = normalizeSemgrep({
    results: [
      { check_id: 'no-eval', path: 'lib/a.js', start: { line: 9 }, extra: { severity: 'ERROR', message: 'eval' } },
      { check_id: 'no-exec', path: 'lib/b.js', start: { line: 2 }, extra: { severity: 'WARNING', message: 'exec' } },
    ],
  });
  assert.equal(findings[0].severity, 'high');
  assert.equal(findings[1].severity, 'medium');
});

test('normalizeTrivy extracts secret findings', () => {
  const findings = normalizeTrivy({
    Results: [{ Target: 'config.json', Secrets: [{ RuleID: 'generic', Severity: 'HIGH', StartLine: 4, Title: 'token' }] }],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tool, 'trivy');
  assert.equal(findings[0].severity, 'high');
  assert.equal(findings[0].line, 4);
});
