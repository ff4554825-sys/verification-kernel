# Mutation Equivalents — kernel.js

Raw Stryker result: **96.94%** (853 killed + 1 timeout / 881; 27 survived).
We do **not** use `// Stryker disable` to raise the score. The survivors are
classified below; several are equivalent only on the Windows test platform.

## Platform-dependent survivors (10)

| Lines | Mutations | Why equivalent on Windows |
|---|---|---|
| 46 | `relative !== ''` guard -> `true`; empty literal -> `"Stryker was here!"` | `relative === ''` makes both `startsWith('..')` and `isAbsolute` false, so the branch outcome is unchanged. |
| 55 | `process.platform === 'win32'` -> true/false/`!==`/`''` | Windows `path.relative`/`path.resolve` comparisons are case-insensitive; lower/upper normalization is observationally equivalent for the tested paths. |
| 56 | `toLowerCase` -> `toUpperCase` | Same case-insensitive Windows path behavior. |
| 57 | POSIX branch `(value) => path.resolve(value)` -> `() => undefined` | The POSIX branch is not executed on Windows. |
| 61 | `relative === ''` -> `false`/`"Stryker was here!"` | Same empty-relative reasoning as line 46. |

These are not equivalent on Linux; the raw score is Windows-specific. A POSIX
mutation run is needed before claiming cross-platform equivalence.

## Redundant validation guards (7)

| Lines | Mutations | Why unobservable |
|---|---|---|
| 71 | default `errors = []` -> `["Stryker was here"]` | The default array is only mutated internally and never returned. |
| 73 | `typeof raw !== 'object'` guard -> `false` | Later field checks plus the final guard still return `null` for the tested primitives. |
| 88 | `cwd === undefined ? undefined : cwd` -> `false ? ...` | When `cwd` is undefined both branches produce `undefined`; when defined both produce the value. |
| 92 | duplicated invalid-field guard -> `false` / empty-literal branch | The same invalid field already appended an error and the final guard still rejects the check. |
| 121 | `if (check !== null)` -> `true` | A null check only occurs after an error; the plan is still rejected. |

## Empty-plan / fallback branches (7)

| Lines | Mutations | Why unobservable |
|---|---|---|
| 247 | early empty-plan guard component -> `false` | The loop over an empty check list produces the same empty summary; no check body runs. |
| 248 | empty-plan id guards -> `true`/`false`/empty literal | For the tested plans the id is either valid or falls back to `verification`; status is unchanged. |
| 308 | `passedAt > 0` -> `>= 0` | `passedAt === 0` is handled by the preceding `pass` branch; negative values never set flaky. |
| 397 | default `mode = 'enforce'` -> `''` | `''` is not off/dry-run, so it follows the same fallthrough enforcement path. |
| 398 | `attempt >= 0` -> `> 0` | `0` and negative/non-integer attempts both become `0`; no observable branch differs. |
| 399 | `cap >= 0` -> `> 0`/`true` | A cap of `0` is handled by `cap <= 0`; negative caps fall back to `0`. |

## Caveat

This is a **manual equivalence classification**, not an automated proof. Until
each group is proved or suppressed with a reviewed Stryker annotation, the
reported score remains the raw **96.94%**, and the gate threshold stays at 96%.
