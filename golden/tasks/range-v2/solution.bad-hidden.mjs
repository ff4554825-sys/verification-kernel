export function range(start, end, step = 1) {
  if (step <= 0) return [];
  const out = [];
  for (let value = start; value < end; value += step) out.push(value);
  return out;
}
