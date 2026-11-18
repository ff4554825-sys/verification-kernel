# Parse a duration

Implement `parseDuration(text)` in `solution.mjs`.

## Contract

- 接受 `数字 + 单位` 形式，单位只允许 `h`、`m`、`s`（大小写不敏感，数字与单位之间允许空白）。
- 返回秒数：`h` 乘 3600，`m` 乘 60，`s` 乘 1。
- 无法解析时返回 `null`，不抛异常。

Run `node test.mjs` to check your work.
