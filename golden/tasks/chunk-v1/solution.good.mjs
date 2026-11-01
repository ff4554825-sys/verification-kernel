export function chunk(values, size) {
  if (!Number.isInteger(size) || size <= 0) return [];
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}
