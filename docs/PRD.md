# Other Pitch: Product Requirements (v2.0, 2026-10-21)

Supersedes [PRD v0.1](PRD-v1.md). The full Chinese planning document is [PLAN-v2.md](PLAN-v2.md); this PRD is its English, judge-facing summary.

## 1. Definition

**Your call. Another possibility.** Other Pitch turns a football replay into a decision you make yourself: choose a route, watch your own branch, compare it with the alternative, then change one condition and see why the value of the choice changes.

v1's core flaw was that the user's choice did not change what played. In v2 the choice decides which simulated branch plays first.

## 1b. v2.1 change: Sandbox as the main mode (2026-10-21)

User feedback: "Only three rounds; it must allow arbitrary changes and still really compute." Response:

- The analytic engine (pass completion, possession risk, shot quality, V, outcome tree, branch trajectories) is ported to TypeScript and runs in the browser. A parity test against Python covers the 3 plays plus the held-out input with exact agreement.
- **Sandbox**: drag any player or the carrier, add or remove defenders and attackers, give the ball, change six model parameters, randomize a legal setup. Every change auto-generates candidates (a pass to each onside team-mate plus a shot), recomputes them all (under 50 ms budget; measured about 2–3 ms including redraw), re-ranks them, and shows deltas against the previous state.
- Explanations for arbitrary states use the deterministic template explainer. Client-side QA enforces "no claim without a computed value": evidence is keyed by state hash, action and metric; display formats are checked; free text may not contain numbers.
- The 3 curated plays remain as the tutorial. Any play can be opened in the Sandbox ("Edit this play"). Setups are shareable via an encoded URL.

## 2. User and moment

- **Primary user:** a fan who wants to join the discussion and understand a little more football. Half-time, a pause, post-match sharing, or a second screen.
- **Core question:** "If it were you, what would you do?"
- **Secondary user (later):** club or broadcast media producers who want a validated "what if" segment with an audit trail.

## 3. Experience (P0)

| Step | Screen | User action | System |
|---|---|---|---|
| Enter | Scoreline, clock, attack direction, "What would you do?" | Start the play, or skip to the decision | Load the validated bundle; no recommendation is shown |
| Approach | 3 s shared lead-in | Watch | Same frames for every branch |
| Decide | 3 actions as buttons and pitch targets | Pick one | Choice is locked for the round |
| Your branch | Your route plays first (solid amber) | Watch / replay | Ball, receiver and key defender move under one public rule set |
| Compare | Tabs: Your choice / Recorded / Another option | Switch | Every branch restarts from the same t0 and window |
| Change one condition | Base / Okada steps into the passing lane (play 1) | Toggle | Loads the bundle computed from the moved defender; shows the before → after delta |
| Recap | Three choices, recorded actions, strongest route, takeaways | Play again / copy challenge link | Progress kept in localStorage; no account |

Three structurally different plays: **You missed the middle** (central run vs wide vs long shot), **Open is not the same as safe** (free far-post receiver, but the pass travels through a defender's zone), **A good choice can still fail** (shot vs square pass are close). A fourth **held-out input** with no hand-written explanation runs through the same pipeline and is shown in "About this model".

Casual and Analyst views share the same metrics. Casual: one sentence and at most two named numbers. Analyst: the metric table for all actions, the outcome tree, inputs, definitions, assumptions and evidence IDs, plus lane and interception zone overlays.

Challenge links carry only scene, version, variant and an optional pick. The friend's pick stays hidden until they choose.

## 4. Metrics (all synthetic, not calibrated)

| Metric | Definition | Display |
|---|---|---|
| p_complete | Internal estimate that the first pass is controlled by the intended team-mate (distance, lane block at t0, receiver pressure on arrival). Null for shots. | Estimated pass completion, e.g. 82% |
| p_lose_possession | Sum of outcome-tree leaves where possession is lost before the 8 s window ends or the first shot | Estimated possession risk, % |
| q_shot | Synthetic 0–1 shot quality at the moment of the shot, given a shot | Simulated shot quality, N / 100 |
| V (opportunity_value) | Sum over leaves of probability × shot quality for the first legal shot within 8 s; no-shot paths count 0 | Opportunity quality, N / 100. Never called a goal probability |

The outcome tree is analytic: a pass has an intercepted leaf (turnover) and a completed leaf (followed by a shot or a timeout under the fixed follow-up rule *one-control-one-shot-v1*). Leaves in each tree sum to 1. Each animation is one representative path, not the probability calculation.

Counterfactual invariants: same base_state_hash and t0, only the declared intervention changes (recorded field, before, after), no access to future frames, same window, policy and engine version.

Current values (engine toy-v2.0):

| Scene | Variant | Action | Est. pass completion | Est. possession risk | Opportunity quality | QA |
|---|---|---|---|---|---|---|
| central-lane | base | Wide to Okonkwo (recorded) | 66% | 34% | 6 / 100 | validated_first_pass |
| central-lane | base | Through ball to Quinn | 82% | 18% | 39 / 100 | validated_first_pass |
| central-lane | base | Shoot from range | n/a | 0% | 5 / 100 | validated_first_pass |
| central-lane | lane_closed | Wide to Okonkwo (recorded) | 66% | 34% | 6 / 100 | validated_first_pass |
| central-lane | lane_closed | Through ball to Quinn | 29% | 71% | 14 / 100 | validated_first_pass |
| central-lane | lane_closed | Shoot from range | n/a | 0% | 5 / 100 | validated_first_pass |
| open-not-safe | base | Cross to Navarro (recorded) | 12% | 88% | 0 / 100 | validated_first_pass |
| open-not-safe | base | Short to Voss | 82% | 18% | 8 / 100 | validated_first_pass |
| open-not-safe | base | Shoot from the angle | n/a | 0% | 4 / 100 | validated_first_pass |
| close-call | base | Shoot now (recorded) | n/a | 0% | 16 / 100 | validated_first_pass |
| close-call | base | Square to Quinn | 64% | 36% | 13 / 100 | validated_first_pass |
| close-call | base | Back to Hart | 73% | 27% | 8 / 100 | validated_first_pass |
| heldout-01 | base | Inside to Quinn | 43% | 57% | 12 / 100 | validated_first_pass |
| heldout-01 | base | Short to Voss (recorded) | 53% | 47% | 6 / 100 | validated_first_pass |
| heldout-01 | base | Shoot | n/a | 0% | 3 / 100 | validated_first_pass |

The lane change does not flip the strongest route in play 1. The through ball stays strongest, but its completion drops from 82% to 29% and its opportunity quality from 39 to 14. The product reports this honestly ("Strongest route unchanged") and does not force a flip.

## 5. Agents, MCP and QA

- Microsoft Agent Framework 1.22 workflow: **Moment Director** (reads the snapshot and legal actions via MCP; decides whether the moment is worth comparing and whether a base comparison is needed; rejects invalid input), **Replay Analyst** (calls simulate_branch and get_evidence via MCP; picks the explanation focus from lane_blocked / receiver_space / shot_quality / close_tradeoff / insufficient_evidence), **Fan Editor** (renders Casual and Analyst explanations from typed claims; optional LLM rewrite), **QA** (conditional edge back to the Fan Editor, at most 2 revisions), then Publisher or Rejector.
- Real MCP: a stdio server (`otherpitch.v2.mcp_server`) with get_decision_snapshot, list_legal_actions, simulate_branch and get_evidence, called by an `mcp.ClientSession` inside the workflow. Every call is logged in the trace with arguments, returned evidence IDs and timings.
- QA checks "whose value, which metric": evidence exists in the bundle; subject (scene, variant, action) matches; metric name, unit and display conversion match (0.82 → "82%", V 0.39 → "39 / 100"); no cross-metric borrowing; normalized scores are never labelled as probabilities; free text may not introduce unbound numbers or "goal probability" wording.
- Normal runs pass first time. A labelled **fault-injection** diagnostic (`--fault-injection`) injects one wrong-subject claim to show rejection → revision → pass.

## 6. Models and providers

- The explainer is pluggable (`OTHERPITCH_LLM`): `deterministic` (default, no network), `foundry` (Azure AI Foundry OpenAI-compatible endpoint), `openai_compatible`. Any failure falls back to the template and QA re-validates.
- **The published bundles were generated with the deterministic template explainer.** No hosted LLM and no Foundry model were called for them, so the project does not claim Foundry use.
- GitHub Models is not used. It was retired on 2026-07-30.
- TypeSafe Jev (System One, Choice) is an optional, **disabled-by-default** interface stub (`otherpitch/v2/jev.py`). It is not integrated and makes no network calls.

## 7. Scope

P0 (this version): items 1–4 above, honest cached-result labelling, failure states (retry, kept previous screen, invalid challenge link, version mismatch notice), desktop and about 390 px mobile.

Not in P0: a second condition, Chinese UI, share image cards, a live generation backend, Jev integration, A2A, accounts, leaderboards, real players or clubs.

## 8. Acceptance

- Different choices play different branch data, motion and explanations from the same state hash.
- Play 1's condition change is a single recorded position diff and changes the computed completion, opportunity quality and explanation.
- Three plays plus a held-out input go through the same import → MCP → simulate → agents → QA → bundle path.
- `pytest` covers branch differences, tree conservation, horizon bounds, the single-field intervention, wrong-subject/metric/unit/display claims, unbound numbers, the first-pass QA pass, real MCP calls, fault injection and held-out handling.
