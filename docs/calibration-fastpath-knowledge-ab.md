# Calibration, Fast Path, Knowledge Base, and A/B

All four features are **deterministic and advisory**, not model training.

## 1. Outcome calibration

```bash
node bin/calibrate.js \
  --store .dsh/verification/outcomes.jsonl \
  --min-runs 3 --out .dsh/verification/calibration.json --json
```

- Reads append-only outcome records.
- Per project/check: runs, pass/fail/unknown/flaky, retries, p95.
- Recommends `stabilize`, `investigate-unknown`, `slow-check`, or
  `fast-candidate`.
- **Never edits config or disables a required check.**
- Check-level detail exists only for records written after `checksDetail` was
  added; older records contribute project-level statistics only.

## 2. Complexity fast path

```bash
node bin/workflow.js ...   # unaffected
# or through the turn gate
```

Config example:

```yaml
fastPath:
  enabled: true
  maxFiles: 6
  maxLines: 80
  allowPaths: ['docs/', 'README.md', 'AGENTS.md']
  checks: ['syntax']
```

- Git repo: uses `git diff` files/lines and path policy.
- Non-git repo: first gate creates `.dsh/verification/tree-snapshot.json`;
  later turns compare mtime/size.
- Docs-only or small allowed-scope changes run only `fastPath.checks`.
- Source changes, large diffs, or missing baseline run the full plan.
- Any git failure falls back to the full plan; no model is asked "is this
  simple?".
- The verdict records `fastPath` and `selectedCheckIds`.

## 3. Local knowledge base

```bash
node bin/knowledge.js --root . --index --json
node bin/knowledge.js --root . --query "mutation score" --limit 5
```

- SQLite FTS5 via Node 22+ `node:sqlite`.
- Indexes README/AGENTS.md/docs-like files; skips `.git`, `node_modules`,
  `.dsh`, `tools`, build output.
- Latin terms plus **CJK character bigrams** (inspired by Hermes'
  `hermes_state_fts.py`).
- Index DB: `.dsh/knowledge/knowledge.db`; refreshed when file mtime/size
  changes.
- Host tool: `knowledge_search` (project-aware, defaults to cwd).
- No embeddings/vector DB; no model memory claim.

## 4. A/B evaluation

```bash
node bin/ab.js --control control.jsonl --treatment treatment.jsonl \
  --key task --bootstrap 2000 --json
```

- Pairs observed outcome records by `task`/`taskId`/`project`.
- Reports pass-rate delta, wins/losses/ties, p50 latency delta, cost-proxy
  delta, and a deterministic paired bootstrap 95% CI.
- Status semantics: `pass` = 1; `fail`/`unknown`/`flaky` = 0.
- This is **paired evaluation**, not proof of model IQ. A real model A/B needs
  two labeled session sets; we have only fixture/benchmark data so far.

## Automatic feedback loop

With `autoFeedback: true`, `knowledge_search` retrieval records are consumed by
the next same-project/agent verification outcome (2-hour window). Pass/fail
updates `doc:` weights with a small bounded step; unknown/flaky do not train.
Each event is consumed once and logged as `weak-retrieval-window` in
`.dsh/learning/attributions.jsonl`; calibration.json is refreshed automatically.
See [local-policy-learning.md](local-policy-learning.md) for the safety caveats.

## Hermes reuse

See [reuse-hermes-agent.md](reuse-hermes-agent.md). The upstream project is
MIT-licensed; no code was copied, only design references were used.
