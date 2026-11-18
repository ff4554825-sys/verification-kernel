export function range(start, end, step = 1) {
  if (step === 0) return [];
  const out = [];
  if (step > 0) for (let value = start; value < end; value += step) out.push(value);
  else for (let value = start; value > end; value += step) out.push(value);
  return out;
}
