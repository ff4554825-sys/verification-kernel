export function titleCase(text) {
  const words = String(text).trim().split(/\s+/);
  if (words.length > 0) words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
  return words.join(' ');
}
