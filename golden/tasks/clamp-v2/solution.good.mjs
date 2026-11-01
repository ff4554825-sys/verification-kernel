export function clamp(value, min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.min(high, Math.max(low, value));
}
