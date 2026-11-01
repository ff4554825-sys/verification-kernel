export function titleCase(text) {
  return String(text).trim().split(/\s+/).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}
