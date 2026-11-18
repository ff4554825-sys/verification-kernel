export function sumEven(values) {
  return values.filter((value) => value % 2 === 0).reduce((sum, value) => sum + value, 0);
}
