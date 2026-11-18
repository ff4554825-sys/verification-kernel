export function getPath(object, path) {
  let current = object;
  for (const key of String(path).split('.')) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) return undefined;
    current = current[key];
  }
  return current;
}
