export function parseDuration(text) {
  const match = String(text).trim().match(/^(\d+)\s*([hm])$/i);
  if (match === null) return null;
  const value = Number(match[1]);
  return match[2].toLowerCase() === 'h' ? value * 3600 : value * 60;
}
