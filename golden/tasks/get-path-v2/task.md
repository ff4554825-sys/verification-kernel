# Read a nested path

Implement `getPath(object, path)` in `solution.mjs`.

## Contract

- `path` 以 `.` 分隔，逐段下钻；数字段用于数组下标。
- 任一段取到的值为 `null` 或 `undefined` 时返回 `undefined`，不抛异常。

Run `node test.mjs` to check your work.
