export function parseDuration(text) {
  const match = String(text).trim().match(/^(\d+)\s*([hms])$/i);
  if (match === null) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  return unit === 'h' ? value * 3600 : unit === 'm' ? value * 60 : value;
}
