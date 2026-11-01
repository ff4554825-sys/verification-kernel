import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContract, formatChecklist } from '../lib/contract.js';

test('normalizeContract accepts criteria strings/objects and claims', () => {
  const { contract, errors } = normalizeContract({
    id: 'demo',
    goal: 'Ship the fix',
    acceptanceCriteria: ['tests pass', { id: 'ac-2', statement: 'docs updated', required: false }],
    claims: [{ id: 'c1', statement: 'the fix is exercised', type: 'code', evidence: ['ac-1'] }],
    unknownPolicy: 'review',
  });
  assert.deepEqual(errors, []);
  assert.equal(contract.acceptanceCriteria.length, 2);
  assert.equal(contract.acceptanceCriteria[0].id, 'ac-1');
  assert.equal(contract.acceptanceCriteria[1].required, false);
  assert.equal(contract.claims[0].type, 'code');
  const checklist = formatChecklist(contract);
  assert.match(checklist, /Contract demo/);
  assert.match(checklist, /ac-1/);
  assert.match(checklist, /c1 \(code\)/);
  assert.match(checklist, /Unknown policy: review/);
});

test('normalizeContract rejects missing goal/criteria and invalid claim types', () => {
  const missing = normalizeContract({ id: 'demo', acceptanceCriteria: [] });
  assert.equal(missing.contract, null);
  assert.ok(missing.errors.some((message) => message.includes('goal')));
  assert.ok(missing.errors.some((message) => message.includes('acceptanceCriteria')));

  const invalidClaim = normalizeContract({
    id: 'demo',
    goal: 'g',
    acceptanceCriteria: ['a'],
    claims: [{ id: 'c1', statement: 's', type: 'guess' }],
  });
  assert.equal(invalidClaim.contract, null);
  assert.ok(invalidClaim.errors.some((message) => message.includes('type')));

  const duplicate = normalizeContract({
    id: 'demo',
    goal: 'g',
    acceptanceCriteria: [{ id: 'x', statement: 'a' }],
    claims: [{ id: 'x', statement: 'b', type: 'fact' }],
  });
  assert.equal(duplicate.contract, null);
  assert.ok(duplicate.errors.some((message) => message.includes('duplicate')));
});
