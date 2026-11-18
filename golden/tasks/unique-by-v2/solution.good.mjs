export function uniqueBy(values, key) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const id = typeof key === 'function' ? key(value) : value[key];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(value);
  }
  return out;
}
