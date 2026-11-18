import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePreTool, invocationText, normalizePreTool } from '../lib/pretool.js';

const config = normalizePreTool({
  enabled: true,
  rules: [
    { id: 'no-force-push', tools: ['bash'], pattern: 'git\\s+push\\s+.*(-f|--force)', reason: 'force push denied' },
    { id: 'no-rm-root', pattern: 'rm\\s+-rf\\s+/(?=[\\s"]|$)', reason: 'refusing to delete the filesystem root' },
  ],
});

test('a rule denies the invocation it matches', () => {
  const verdict = evaluatePreTool(config, { name: 'bash', input: { command: 'git push --force origin main' } });
  assert.deepEqual(verdict, { denied: true, ruleId: 'no-force-push', reason: 'force push denied' });
});

test('a rule with a tools list ignores other tools', () => {
  const verdict = evaluatePreTool(config, { name: 'read', input: { command: 'git push --force' } });
  assert.equal(verdict.denied, false);
});

test('a rule without a tools list applies to every tool', () => {
  const verdict = evaluatePreTool(config, { name: 'anything', input: { command: 'rm -rf /' } });
  assert.equal(verdict.denied, true);
  assert.equal(verdict.ruleId, 'no-rm-root');
});

test('a near miss is not denied', () => {
  assert.equal(evaluatePreTool(config, { name: 'bash', input: { command: 'git push origin main' } }).denied, false);
  assert.equal(evaluatePreTool(config, { name: 'bash', input: { command: 'rm -rf /tmp/scratch' } }).denied, false);
});

test('disabled or absent config denies nothing', () => {
  assert.equal(evaluatePreTool(null, { name: 'bash', input: { command: 'rm -rf /' } }).denied, false);
  assert.equal(evaluatePreTool(normalizePreTool({ enabled: false }), { name: 'bash', input: {} }).denied, false);
  assert.equal(normalizePreTool(undefined), null);
});

test('an invalid regex is reported and dropped, not thrown', () => {
  const warnings = [];
  const parsed = normalizePreTool({ enabled: true, rules: [{ id: 'bad', pattern: '([unclosed' }] }, warnings);
  assert.deepEqual(parsed.rules, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /not a valid regular expression/);
});

test('the matcher reads whichever field the host uses for the input', () => {
  assert.match(invocationText({ tool_input: { command: 'x' } }), /"command":"x"/);
  assert.match(invocationText({ input: 'plain string' }), /plain string/);
  assert.equal(invocationText({}), '');
  assert.equal(invocationText(null), '');
  const circular = {};
  circular.self = circular;
  assert.equal(invocationText({ input: circular }), '');
});
