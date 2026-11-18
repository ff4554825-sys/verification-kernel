# Local Policy Learning — Three-Factor Update

The image formula is implemented as a **bounded local retrieval/policy update**,
not as LLM training.

\[
\Delta\omega=\eta\cdot\bigl(\text{trace}_{pre}\cdot\text{trace}_{post}\cdot(R-b)\bigr)\cdot(\lambda\rho\sigma)
\]

| Symbol | Our mapping |
|---|---|
| \(\omega\) | local retrieval weight for a key such as `doc:docs/guide.md` or `term:alpha` |
| \(\eta\) | learning rate (default `0.05`) |
| \(\text{trace}_{pre}\) | pre-outcome feature strength (caller supplies; default `1`) |
| \(\text{trace}_{post}\) | post-outcome feature strength (caller supplies; default `1`) |
| \(R\) | reward: pass `+1`, fail `-1`, unknown/flaky `0` |
| \(b\) | running baseline reward (EMA), so positive outcomes do not cause unbounded drift |
| \(\lambda\) | eligibility/decay factor (default `0.95`) |
| \(\rho\) | scale factor (default `1`) |
| \(\sigma\) | confidence/noise scaling (default `1`) |

Implementation details:

- step is clipped to `±maxStep` (default `0.1`);
- weight is clamped to `[minWeight, maxWeight]` (default `[-1, 1]`);
- update history is bounded to 500 entries;
- policy is stored atomically as JSON.

## Commands

```bash
# update a local retrieval weight
node bin/local-learn.js \
  --policy .dsh/learning/retrieval-policy.json \
  --key term:verification \
  --pre 1 --post 0.5 --status pass --eta 0.1

# inspect
node bin/local-learn.js --policy .dsh/learning/retrieval-policy.json --show --json
```

The knowledge base reads
`.dsh/learning/retrieval-policy.json` and reranks FTS results with
`adjustedScore = bm25 - learnedBoost`.

## Automatic feedback loop

`knowledge_search` records each returned result in
`.dsh/learning/retrievals.jsonl` with project/agent/time. When a verification
outcome is recorded and `autoFeedback: true`:

1. Find unconsumed retrievals for the same project/agent inside a 2-hour window.
2. Only `pass`/`fail` provide a reward (`unknown`/`flaky` do not train).
3. Update `doc:<path>` keys with a small learning rate (`eta 0.01`,
   `maxStep 0.02`), top 3 results per retrieval.
4. Mark retrievals consumed; append `.dsh/learning/attributions.jsonl` with
   attribution `weak-retrieval-window`.
5. Refresh `.dsh/verification/calibration.json` from outcome records.

This is **automatic but correlational**, not causal attribution. It is labeled
weak because the outcome may have been caused by something other than the
retrieved docs. The low rate, baseline, clipping, and per-event consumption
limit damage; A/B is still required before trusting it.

## Safety and evidence

- This is **not** a model weight update and cannot improve the LLM's raw
  intelligence.
- Reward comes from verified outcomes, not from the model's self-report.
- Automatic attribution is weak/correlational; only a 2-hour same-session
  retrieval window is used, and unknown/flaky outcomes do not train.
- Use `dsh-ab` to compare baseline vs learned reranking; do not assume the
  update helps without a paired evaluation.

The design follows the general reward-modulated Hebbian form; Hermes Agent's
memory/skill graph was reviewed as a reference (see
[reuse-hermes-agent.md](reuse-hermes-agent.md)).
