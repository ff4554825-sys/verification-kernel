/**
 * A tiny deterministic generator for property tests.
 *
 * The kernel has no runtime dependencies and the test suite has none either.
 * A 30-line seeded generator covers what these properties need; shrinking a
 * failing case is not implemented, so a failure prints the seed instead.
 */

/** xorshift32: same seed, same sequence, on every machine. */
export function rng(seed) {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

export function int(rand, max) {
  return Math.floor(rand() * (max + 1));
}

export function oneOf(rand, values) {
  return values[int(rand, values.length - 1)];
}

export function boolean(rand) {
  return rand() < 0.5;
}

/** Run an async `body(rand, index)` `count` times with a reproducible seed. */
export async function forAllAsync(count, seed, body) {
  const rand = rng(seed);
  for (let index = 0; index < count; index += 1) {
    try {
      await body(rand, index);
    } catch (error) {
      error.message = `${error.message} (seed ${seed}, case ${index})`;
      throw error;
    }
  }
}

/** Run `body(rand, index)` `count` times with a reproducible seed. */
export function forAll(count, seed, body) {
  const rand = rng(seed);
  for (let index = 0; index < count; index += 1) {
    try {
      body(rand, index);
    } catch (error) {
      error.message = `${error.message} (seed ${seed}, case ${index})`;
      throw error;
    }
  }
}
