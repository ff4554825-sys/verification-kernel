/** Acceptance-contract validation for the accuracy-first verification workflow. */

const CLAIM_TYPES = new Set(['fact', 'code', 'math', 'decision']);
const UNKNOWN_POLICIES = new Set(['allow', 'block', 'review']);

function normalizeCriterion(raw, index, errors, prefix = 'acceptanceCriteria') {
  const label = `${prefix}[${index}]`;
  if (typeof raw === 'string') {
    const statement = raw.trim();
    if (statement === '') {
      errors.push(`${label} must not be empty`);
      return null;
    }
    return { id: `ac-${index + 1}`, statement, required: true };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`${label} must be a string or an object`);
    return null;
  }
  const statement = typeof raw.statement === 'string' ? raw.statement.trim() : '';
  if (statement === '') errors.push(`${label}.statement must be a non-empty string`);
  const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : `ac-${index + 1}`;
  const required = raw.required === undefined ? true : raw.required;
  if (typeof required !== 'boolean') errors.push(`${label}.required must be a boolean`);
  if (statement === '' || typeof required !== 'boolean') return null;
  return { id, statement, required };
}

/**
 * Validate an acceptance contract. Returns `{ contract, errors }`; `contract`
 * is null when any error exists.
 */
export function normalizeContract(raw) {
  const errors = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { contract: null, errors: ['contract must be an object'] };
  }
  const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : '';
  if (id === '') errors.push('contract.id must be a non-empty string');
  const goal = typeof raw.goal === 'string' ? raw.goal.trim() : '';
  if (goal === '') errors.push('contract.goal must be a non-empty string');
  if (!Array.isArray(raw.acceptanceCriteria) || raw.acceptanceCriteria.length === 0) {
    errors.push('contract.acceptanceCriteria must be a non-empty array');
  }
  const acceptanceCriteria = [];
  for (const [index, value] of (Array.isArray(raw.acceptanceCriteria) ? raw.acceptanceCriteria : []).entries()) {
    const criterion = normalizeCriterion(value, index, errors);
    if (criterion !== null) acceptanceCriteria.push(criterion);
  }

  const claims = [];
  if (raw.claims !== undefined) {
    if (!Array.isArray(raw.claims)) errors.push('contract.claims must be an array');
    for (const [index, value] of (Array.isArray(raw.claims) ? raw.claims : []).entries()) {
      const label = `claims[${index}]`;
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${label} must be an object`);
        continue;
      }
      const statement = typeof value.statement === 'string' ? value.statement.trim() : '';
      if (statement === '') errors.push(`${label}.statement must be a non-empty string`);
      const claimId = typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : `claim-${index + 1}`;
      const type = typeof value.type === 'string' ? value.type : 'decision';
      if (!CLAIM_TYPES.has(type)) errors.push(`${label}.type must be one of ${[...CLAIM_TYPES].join('|')}`);
      const required = value.required === undefined ? true : value.required;
      if (typeof required !== 'boolean') errors.push(`${label}.required must be a boolean`);
      const evidence = value.evidence === undefined
        ? []
        : Array.isArray(value.evidence) && value.evidence.every((item) => typeof item === 'string' && item !== '')
          ? [...value.evidence]
          : null;
      if (evidence === null) errors.push(`${label}.evidence must be an array of non-empty strings`);
      if (statement !== '' && CLAIM_TYPES.has(type) && typeof required === 'boolean' && evidence !== null) {
        claims.push({ id: claimId, statement, type, required, evidence });
      }
    }
  }

  const seen = new Set();
  for (const item of [...acceptanceCriteria, ...claims]) {
    if (seen.has(item.id)) errors.push(`duplicate id '${item.id}' in contract`);
    seen.add(item.id);
  }

  const nonGoals = Array.isArray(raw.nonGoals) && raw.nonGoals.every((item) => typeof item === 'string') ? [...raw.nonGoals] : [];
  if (raw.nonGoals !== undefined && !Array.isArray(raw.nonGoals)) errors.push('contract.nonGoals must be an array of strings');
  const constraints = Array.isArray(raw.constraints) && raw.constraints.every((item) => typeof item === 'string') ? [...raw.constraints] : [];
  if (raw.constraints !== undefined && !Array.isArray(raw.constraints)) errors.push('contract.constraints must be an array of strings');
  const evidence = Array.isArray(raw.evidence) && raw.evidence.every((item) => typeof item === 'string' && item !== '') ? [...raw.evidence] : [];
  if (raw.evidence !== undefined && !Array.isArray(raw.evidence)) errors.push('contract.evidence must be an array of strings');
  const unknownPolicy = raw.unknownPolicy === undefined ? 'review' : raw.unknownPolicy;
  if (!UNKNOWN_POLICIES.has(unknownPolicy)) errors.push(`contract.unknownPolicy must be one of ${[...UNKNOWN_POLICIES].join('|')}`);

  if (errors.length > 0) return { contract: null, errors };
  return {
    contract: {
      id,
      goal,
      acceptanceCriteria,
      ...(nonGoals.length > 0 ? { nonGoals } : {}),
      ...(constraints.length > 0 ? { constraints } : {}),
      ...(claims.length > 0 ? { claims } : {}),
      ...(evidence.length > 0 ? { evidence } : {}),
      unknownPolicy,
    },
    errors: [],
  };
}

export function formatChecklist(contract) {
  const lines = [`Contract ${contract.id}`, `Goal: ${contract.goal}`];
  if (contract.nonGoals !== undefined) lines.push(`Non-goals: ${contract.nonGoals.join('; ')}`);
  if (contract.constraints !== undefined) lines.push(`Constraints: ${contract.constraints.join('; ')}`);
  lines.push('Acceptance criteria:');
  for (const criterion of contract.acceptanceCriteria) {
    lines.push(`  [ ] ${criterion.id}${criterion.required ? '' : ' (optional)'} — ${criterion.statement}`);
  }
  if (contract.claims !== undefined) {
    lines.push('Claims:');
    for (const claim of contract.claims) {
      lines.push(`  [ ] ${claim.id} (${claim.type})${claim.required ? '' : ' (optional)'} — ${claim.statement}`);
      if (claim.evidence.length > 0) lines.push(`      evidence: ${claim.evidence.join(', ')}`);
    }
  }
  if (contract.evidence !== undefined) lines.push(`Evidence: ${contract.evidence.join(', ')}`);
  lines.push(`Unknown policy: ${contract.unknownPolicy}`);
  return lines.join('\n');
}
