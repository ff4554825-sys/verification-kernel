export function uniqueBy(values, key) {
  const index = new Map();
  for (const value of values) {
    const id = typeof key === 'function' ? key(value) : value[key];
    index.set(id, value);
  }
  return [...index.values()];
}
