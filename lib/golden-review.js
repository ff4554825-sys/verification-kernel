/**
 * Human review records for golden tasks.
 *
 * A generated benchmark measures its own generator. SWE-bench Verified exists
 * because 500 tasks were confirmed solvable by humans; this module is the same
 * idea at a smaller scale. A task without a review record still counts as a
 * task, but it does not count as evidence.
 */

export const REVIEW_SCHEMA = 1;

/**
 * Validate a review file against the task ids it claims to cover.
 * @param raw - parsed `golden/reviewed.json`.
 * @param knownIds - task ids present in the manifest.
 * @returns `{ reviews, errors }`; `reviews` maps id to `{ by, at, note }`.
 */
export function normalizeReviews(raw, knownIds) {
  const errors = [];
  const reviews = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { reviews, errors: ['reviewed.json must be an object'] };
  }
  if (raw.schema !== undefined && raw.schema !== REVIEW_SCHEMA) {
    errors.push(`reviewed.json schema ${String(raw.schema)} is not ${REVIEW_SCHEMA}`);
  }
  const tasks = raw.tasks === undefined ? {} : raw.tasks;
  if (tasks === null || typeof tasks !== 'object' || Array.isArray(tasks)) {
    return { reviews, errors: [...errors, 'reviewed.json tasks must be an object'] };
  }
  const known = new Set(Array.isArray(knownIds) ? knownIds : []);
  for (const [id, entry] of Object.entries(tasks)) {
    if (!known.has(id)) {
      errors.push(`reviewed.json names an unknown task: ${id}`);
      continue;
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`review for ${id} must be an object`);
      continue;
    }
    const by = typeof entry.by === 'string' ? entry.by.trim() : '';
    const at = typeof entry.at === 'string' ? entry.at.trim() : '';
    const note = typeof entry.note === 'string' ? entry.note.trim() : '';
    if (by === '') errors.push(`review for ${id} needs a reviewer`);
    if (at === '') errors.push(`review for ${id} needs a date`);
    if (note === '') errors.push(`review for ${id} needs a note saying what was checked`);
    if (by === '' || at === '' || note === '') continue;
    reviews[id] = { by, at, note };
  }
  return { reviews, errors };
}

/** Ids that carry a review record, in manifest order. */
export function reviewedIds(manifestTasks, reviews) {
  const map = reviews ?? {};
  return (Array.isArray(manifestTasks) ? manifestTasks : [])
    .map((task) => task.id)
    .filter((id) => Object.hasOwn(map, id));
}
