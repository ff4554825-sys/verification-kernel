export function sumEven(values) {
  return values.filter((value) => value % 2 === 1).reduce((sum, value) => sum + value, 0);
}
