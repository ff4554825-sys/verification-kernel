# Third-Party Notices

This project is MIT-licensed (see `LICENSE`). It contains original code.

## Design references (no upstream code copied)

- **OpenHands** — <https://github.com/OpenHands/OpenHands>
  - License: MIT outside the `enterprise/` directory.
  - Referenced: verification stack layering, code-review/QA split, custom
    repository review guides, PR-level verification.
  - No OpenHands code or enterprise content is included in this repository.

- **Hermes Agent** — <https://github.com/NousResearch/hermes-agent>
  - License: MIT.
  - Referenced: verify-on-stop policy, SQLite FTS5/CJK ideas, memory/skill
    learning and evaluation concepts.
  - No Hermes Python runtime or code is included in this repository.

## Runtime and development dependencies

Dependencies are declared in `package.json` and retain their own licenses.
Notable direct dev dependencies:

- `@stryker-mutator/core` — Apache-2.0
- `@stryker-mutator/tap-runner` — Apache-2.0

If code is copied from an upstream project in the future, its copyright notice
and license text must be added here before release.
