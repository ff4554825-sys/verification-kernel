export function groupBy(values, key) {
  const out = {};
  for (const value of values) {
    const id = typeof key === 'function' ? key(value) : value[key];
    (out[id] ??= []).push(value);
  }
  return out;
}
