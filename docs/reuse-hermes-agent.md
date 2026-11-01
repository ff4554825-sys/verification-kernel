# Reuse Notes — NousResearch Hermes Agent

Source: <https://github.com/NousResearch/hermes-agent>  
License: **MIT** (upstream `LICENSE`). The repository is Python and includes its
own agent runtime, gateway, memory store, skill loop, and eval harness.

## What we inspected

| Upstream area | Idea worth reusing | Our implementation |
|---|---|---|
| `agent/verification_stop.py` | A turn that edits only prose should not demand a code check; deterministic policy, not a model decision. | `lib/complexity.js` classifies docs-only/small-scope changes; snapshot fallback for non-git projects. |
| `hermes_state_fts.py` | SQLite FTS5 for local recall; explicit handling of 1–2 character CJK terms via bigrams. | `lib/knowledge.js` uses Node 22+ `node:sqlite` FTS5, Latin tokens + CJK bigrams, docs/AGENTS chunking. |
| `agent/learning_graph.py`, `agent/learning_mutations.py` | Memory/skill graph with fingerprints and lexical links; user-editable curated knowledge. | Lightweight knowledge + outcome records; no automatic skill mutation. |
| `evals/postmortem` | Paired A/B and explicit observed/modeled labels; forensics before optimization. | `lib/ab.js` pairs outcomes by task key, reports wins/losses/ties and a deterministic bootstrap CI. |
| `agent/verification_evidence.py`, `verification_stop.py` | Policy-only verification nudges; do not claim verification without fresh evidence. | Already covered by the stronger gate: it actually runs checks and stores evidence. |

## What we did **not** embed

- The Python agent runtime, gateway, session DB, Telegram/Discord adapters.
- The autonomous skill-creation/curator loop and memory mutation system.
- Hermes' specific `state.db` schema or postmortem probes.

Those are tightly coupled to Hermes' Python process and are not a drop-in fit
for the DSH Node Host plugin.

## License handling

No upstream code was copied into this repository. These are design references;
the upstream project is MIT-licensed. If a future change copies code, it must
include the upstream MIT notice and attribution in `THIRD_PARTY_NOTICES.md`.
