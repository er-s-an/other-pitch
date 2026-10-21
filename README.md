# Other Pitch

**Your call. Another possibility.** Make the call in a football replay, watch your own branch, compare it with the alternative, then change one defensive condition and see why the value of the choice changes.

Live: **https://other-pitch.vercel.app** · Product spec: [docs/PRD.md](docs/PRD.md) · Data contract: [docs/v2-data-contract.md](docs/v2-data-contract.md)

All teams, players and positions are fictional. Every number is a transparent, synthetic model estimate. None of them is a calibrated goal probability.

## What you can do

1. **Decide.** Three structurally different plays freeze at a decision. Pick a pass or a shot.
2. **See your branch.** Your choice plays first. Ball, receiver and key defender move under one public rule set.
3. **Compare.** Switch between Your choice, the Recorded action (a synthetic record, not a correct answer) and Another option, all from the same moment.
4. **Change one condition.** In play 1, move Okada into the passing lane. Completion for the through ball drops from 82% to 29% and opportunity quality from 39 to 14 / 100. The strongest route does not change, and the page says so.
5. **Recap and challenge.** See your three calls and send a challenge link. Your friend's view hides your pick until they choose.

Casual and Analyst views use the same metrics. Analyst adds the outcome tree, inputs, definitions, evidence IDs and lane overlays. "About this model" shows the real workflow trace and MCP calls, the held-out input, and a labelled validation test.

## How it is built

```
scenarios.py (3 plays + 1 held-out) ─► simulation.py: frozen snapshot → per-action 2D motion + analytic outcome tree
                                         ▲ MCP stdio server: get_decision_snapshot · list_legal_actions · simulate_branch · get_evidence
Microsoft Agent Framework workflow ──────┘ (called through mcp.ClientSession)
  Moment Director → Replay Analyst → Fan Editor → QA ─(reject ≤2)→ Fan Editor
                                                    └(pass)→ Publisher → immutable bundles in web/public/data/v2
Vite + TypeScript + Canvas site reads the validated bundles (labelled "precomputed, loaded from cache").
```

- **Metrics** (`otherpitch/v2/evidence.py`): estimated pass completion, estimated possession risk, simulated shot quality, and opportunity quality V. V is the probability-weighted quality of the first legal shot within 8 s, with no-shot paths counting 0. Coefficients are reused from `otherpitch/analytics.py` and are heuristic, not fitted.
- **Typed QA** (`otherpitch/v2/qa.py`): every displayed number is a claim bound to one evidence record (scene, variant, action, metric, unit, window, version). Wrong subject, borrowed metric, wrong unit or format, unbound numbers and "goal probability" wording are rejected. Normal runs pass on the first try. `--fault-injection` produces a labelled diagnostic.
- **Explainer**: pluggable (`OTHERPITCH_LLM=deterministic|foundry|openai_compatible`) with a deterministic fallback. The published bundles used the deterministic template; no hosted model was called. GitHub Models is not used; it was retired on 2026-07-30.
- **Jev (TypeSafe)**: optional interface stub, disabled by default, not integrated (`otherpitch/v2/jev.py`).

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q                                   # engine, QA, MCP, workflow tests
.venv/bin/python -m otherpitch.v2.build --out web/public/data/v2 --fault-injection   # producer generation
.venv/bin/python -m otherpitch.v2.mcp_server                    # MCP server over stdio, for any MCP client
cd web && npm install && npm run dev                            # site
```

Deploy: `cd web && npm run build`, then `vercel build --prod` / `vercel deploy --prebuilt --prod` from the repo root.

## Limits

Synthetic plays only; ground passes and shots only; no full offside engine (plays are checked for an onside receiver at t0); the 8 s window is a design choice; one representative animation per action; one condition change (play 1). The v1 pipeline (`otherpitch/*.py` outside `v2/`) is kept for history and is no longer used by the site.

## Licence

See [LICENSE](LICENSE).
