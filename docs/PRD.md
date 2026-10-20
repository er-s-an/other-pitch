# Other Pitch: Product Requirements (v0.1, 2026-10-21)

Status: draft for review. Building is paused until this PRD is approved.

## 1. One-line idea

**Other Pitch replays a key football moment and shows the passes the player did *not* make, each with a probability. Every number has been checked by an agent against the event data before it reaches the screen.**

## 2. Target user and their stuck moment

| | |
|---|---|
| **Primary user** | A casual-to-curious football fan watching a replay on a phone or second screen |
| **Stuck moment** | Minute 67, 1–1. The midfielder plays it wide, and the attack dies. The fan thinks *"why didn't he slide it to the striker?"* but has nothing except a pundit's opinion. Broadcasts show what happened, never what *could* have happened, and never with checked numbers. |
| **After Other Pitch** | Within a few seconds the fan sees the two untaken options drawn as ghost passes with probabilities (pass EV 0.63, shot xG 0.06, played pass 0.004). The fan guesses first, then gets the reveal, and can switch the explanation depth (casual / analyst / Chinese). |
| **Secondary user** | Broadcast or club-media producer. Gets a ready-made "what if" overlay segment (timed JSON) and a trustworthy audit trail of every figure. |

## 3. Why it can win this contest

Microsoft × Premier League **Inside the Game** asks entries to turn *synthetic* football events into explainable match intelligence through a 5-stage pipeline: Ingest → Interpret → Explain → Render → Personalize.

### 3.1 Stage 2 judging (5 × 20%)

| Criterion | How Other Pitch scores |
|---|---|
| **Technological Implementation** (incl. synthetic data creation) | A seeded synthetic generator produces events plus 25 Hz tracking, so the counterfactuals are computable: we own the ground truth. Pass EV / xG / decision-score models. Microsoft Agent Framework workflow. MCP server. |
| **Agentic Design & Innovation** | Six agents with distinct roles, shared match state, typed handoffs, and a **QA reject → retry loop** that is visible in the UI (the "Agent trace"). |
| **Real-World Impact** | A new broadcast segment ("the other pitch") for replays, and trust: numbers are color-coded by source and audited. |
| **UX & Presentation** | The frontend is the product: a cinematic 2D pitch, ghost passes, a guess-the-pass game, minimal text, and a demo video under 2 minutes. |
| **Category Adherence** | Maps 1:1 onto Ingest / Interpret / Explain / Render / Personalize. |

### 3.2 Category prizes (max one per project)

| Category | Fit | What it needs from us |
|---|---|---|
| **Best Multi-Agent System** (A2A / Agent Framework) | **Primary target.** Distinct roles, shared state, handoffs, failure recovery, and an outcome a single agent couldn't produce | Make the agents real (not decoration): show the trace live, and optionally expose agents over A2A |
| Best Use of Microsoft Foundry | Possible only if Foundry can be used **without binding a card** (e.g. Azure for Students) | A Foundry model actually called in the demo |
| Best Enterprise Solution | Secondary story: audit trail, provenance tags, human sign-off | A producer approval step |
| Best Azure Cloud Native | Weak today (hosted on Vercel) | Azure Container Apps / Static Web Apps / Functions without a card |

### 3.3 Inspiration (credited)

Ported from the **AWS × NBA "Broadcast Code 12"** champion and Best Visual winner, **平行世界 (Parallel World)**. In the post-goal replay window it switched to a virtual court and played the 2 *unchosen* passes with probabilities. It used a "Director" agent (verify-then-judge) and **source-colored numbers** (official / measured / estimated). Lessons we keep:

- One moment
- The road not taken
- Few words
- Provenance tags
- Cinematic visuals
- Finish the video early

A non-finalist got "AI architecture 91 / video 38" in feedback, so presentation matters as much as architecture. We copy **no** code, names, assets, footage, or voice. All of it is new work, and the README credits the concept.

## 4. Core user flows

### Flow A: Fan replay (P0, the demo spine)

1. Land on the page and see the title and the frozen pitch (fictional match: Harbour City FC 1–1 Northvale Athletic, 67:00).
2. Tap **Play the move**. The build-up animates from synthetic tracking.
3. Play freezes at the decision frame. The prompt **Guess the pass** shows 3 options (shot / pass A / pass B).
4. The fan picks one and the **reveal** starts:
   - the played pass stays solid;
   - the 2 untaken options draw on as glowing ghost trails;
   - probability chips appear, colored by source.
5. A verdict line says whether the guess matched the real choice and which option had the best value.
6. Switch the mode (Casual / Analyst / 中文). Captions and depth change, and the pitch stays.
7. Open **Agent trace**. The fan sees the handoffs, including QA rejecting a figure and the retry.
8. **Replay**.

### Flow B: Producer / developer (P1)

1. Run `python -m otherpitch.build --seed N`. The agents produce `timeline.json` + `trace.json` + one file per mode.
2. Connect any MCP client to `otherpitch.mcp_server` and query the match state, moment, alternatives, and timeline.
3. (P1) Approve or reject the Director's moment before publishing (human sign-off).

### Flow C: Explore more moments (P1)

1. Pick another seed or moment from a match strip (e.g. 3 key moments).
2. Each gets its own counterfactual replay.

## 5. Feature list and honest audit (vs live https://other-pitch.vercel.app on 2026-10-21)

Status legend: ✅ done · 🟡 partial · ❌ missing

| # | Feature | Pri | Status | Notes |
|---|---|---|---|---|
| 1 | Seeded synthetic events + 25 Hz tracking, fictional clubs | P0 | ✅ | One match (seed 7), 76 events, 325 frames around one minute only |
| 2 | Analyst: pass EV, shot xG, completion, decision score | P0 | ✅ | Simple hand-built models; not calibrated |
| 3 | Director: pick key moment + 2 untaken alternatives | P0 | 🟡 | Picks from one pre-built decision event; no search over a whole match |
| 4 | QA: check every number vs evidence, reject and retry | P0 | ✅ | Works; the first rejection is a **deliberately seeded decoy draft**, which must be disclosed |
| 5 | Overlay: timed timeline JSON | P0 | ✅ | |
| 6 | Personalize: casual / analyst / Chinese | P0 | 🟡 | Template text; no favorite club/player; no single-metric mode |
| 7 | Guess the pass mini-game | P0 | 🟡 | Single round; no score, streak, or share |
| 8 | Animated pitch, ghost passes, source-colored chips | P0 | ✅ | Art pass done 10-21; only one data source (model_estimate) actually appears on chips, so the color coding is barely visible |
| 9 | Agent trace UI | P0 | ✅ | Static from `trace.json`, not live |
| 10 | Microsoft Agent Framework workflow | P0 | ✅ | `agent-framework==1.22.0`, run at build time |
| 11 | MCP server (stdio) | P0 | 🟡 | 5 read tools, unit-tested; not tried with a real MCP client; not hosted |
| 12 | LLM pluggable: GitHub Models / deterministic / Foundry | P0 | 🟡 | Deterministic path only verified; GitHub Models and Foundry **never called for real** |
| 13 | Demo video < 2 min | P0 | ✅ | 57.5 s draft on the review site; needs re-cut once the product is final |
| 14 | Public repo + README + architecture + credit | P0 | ✅ | |
| 15 | Free working test link until 11-10 | P0 | ✅ | Vercel static site; Vercel deploys must be manual (`--prebuilt`) |
| 16 | Heat field / pressure overlay per frame | P1 | ❌ | Was in the 平行世界 port study |
| 17 | Multiple moments per match / match strip | P1 | ❌ | |
| 18 | Live agent run from the browser (call the API, watch the trace stream) | P1 | ❌ | Today the site is static JSON |
| 19 | A2A exposure of agents | P1 | ❌ | Strengthens the Multi-Agent category |
| 20 | Human sign-off step (producer approve) | P1 | ❌ | Enterprise story |
| 21 | Second data source shown (synthetic_tracking vs model_estimate chips) | P1 | 🟡 | Legend exists; chips are mostly one color |
| 22 | Foundry model in the loop | P1 | ❌ | Blocked on a no-card Azure path |
| 23 | Azure hosting (SWA / ACA) | P2 | ❌ | Blocked on a no-card Azure path |
| 24 | Favorite club/player personalization, more languages | P2 | ❌ | |
| 25 | Score / streak / share card for the mini-game | P2 | ❌ | |
| 26 | Remove leftover stock city photo on landing | P0 | ❌ | Off-concept visual |

## 6. Frontend spec (the core)

### 6.1 Screens

1. **Opener / hero.** Big split title "OTHER / PITCH", one-line promise, a scroll cue. *To fix:* replace the stock city photo with a pitch-derived visual (e.g. the ghost-pass still).
2. **Replay stage (main).** Toolbar (Play · modes · Agent trace), pitch canvas, clock/score bar, legend, prompt, choices, verdict.
3. **"The other pitch" explainer.** Three cards (Strike it / played pass / alternative pass), each with a mini still and a one-line explanation.
4. **Trust section.** "QA checks every figure" with a link to the trace.
5. **Agent trace dialog.** An ordered list of handoffs. QA rejection and retry are highlighted.
6. **Footer.** Replay, a fictional-data note, credits.

### 6.2 Interactions

- **Play:** about 3.5 s eased build-up, then freeze at the decision frame. The actor has a pulsing halo.
- **Guess:** 3 pill buttons, plus clickable target markers on the pitch. Hovering previews the target.
- **Reveal:** about 6 s. The played pass is solid. Ghost trails draw on with ease-in-out, a ghost ball travels each path, and the endpoints ripple. Chips follow the ghost ball.
- **Modes:** instant swap of words, no re-animation.
- **Trace:** dialog with scroll.
- **Reduced motion:** jump straight to the end states.
- **Mobile (390 px):** choices stack, chips scale down, no horizontal scroll.

### 6.3 Visual direction

- **Mood:** night match under floodlights, as on a broadcast graphics desk. Dark ground (#0a0d0b), cream ink (#f3f0e7), one teal accent (#3ec1c9) reserved for model estimates.
- **Type:** Big Shoulders Display (numbers, titles), Public Sans (text). Numbers are tabular.
- **Pitch:** mowing stripes, a floodlight pool, a vignette, crisp lines, and player shadows.
- **Numbers:** always in a source-colored chip (teal = model estimate, cream = synthetic tracking). Never a bare number.
- **Words:** at most one sentence on screen at a time. English UI; Chinese only in 中文 mode.

## 7. Agent architecture and sponsor stack

```
Seeded generator → Ingest → Analyst → Director → QA ─┬─ pass → Overlay → Personalize → JSON bundle → Web / MCP
                              ▲                       │
                              └──── reject + reasons ─┘   (retry budget)
```

| Agent | Role | Input → Output |
|---|---|---|
| Ingest | Load synthetic events and tracking, locate the decision | seed → match state |
| Analyst | Pressure, pass EV, shot xG, ranking | state → analysis with evidence IDs |
| Director | Pick the moment, the taken action, and 2 alternatives; draft captions | analysis → moment draft |
| QA | Check every figure and claim against the cited evidence; reject and retry | draft → pass / reject(reasons) |
| Overlay | Timed ghost trails, chips, frames | moment → timeline.json |
| Personalize | Casual / analyst / Chinese copy and the quiz | timeline → per-mode files |

| Sponsor tech | Use | Status |
|---|---|---|
| Microsoft Agent Framework | Workflow, typed handoffs, shared state, retry | ✅ |
| MCP (Azure MCP-compatible stdio server) | Match-state tools for any agent client | 🟡 local only |
| GitHub Models (free, no card) | Optional LLM caption rewrite; QA still gates numbers | 🟡 unverified |
| Microsoft Foundry | Same provider interface (`OTHERPITCH_LLM=foundry`) | ❌ documented, unused |
| GitHub Copilot Agent Mode / GitHub CLI | Build tooling, repo | ✅ (state it honestly in the pitch) |
| Azure hosting | — | ❌ |

## 8. Data rules

- **Synthetic only.** All events and tracking come from `otherpitch/generator.py` with a seed. No real match data, footage, or broadcast feeds.
- **Fictional only.** Clubs (Harbour City FC, Northvale Athletic), players, and kits are invented. No real PL clubs, crests, player names, or trademarks. No copyrighted music in the video.
- Every displayed number carries a source tag (`synthetic_tracking` or `model_estimate`) and an evidence ID that QA can verify.
- Model numbers are illustrative estimates, not calibrated predictions. The UI and pitch say so.

## 9. Non-goals

- Real-time ingestion of live matches or video computer vision.
- Calibrated, production-grade xG/EV models.
- Betting, odds, or anything that reads as gambling.
- Accounts, login, payments. **Never bind a card**, so no paid Azure.
- 3D rendering.
- Submitting to Devpost or Innovation Studio, or uploading to YouTube, without explicit user approval.

## 10. Demo success criteria

1. A stranger understands the idea from the first 10 seconds of the video, with no voice-over.
2. In the live demo, Flow A (play → guess → reveal → mode → trace) completes in under 30 s with no errors on desktop and mobile.
3. Every number on screen matches a QA-passed evidence entry, and the trace shows at least one real reject → retry.
4. The video is under 2 minutes, English, has no real clubs or music, and shows Agent Framework + MCP explicitly.
5. The public repo runs end to end: `pytest` green, plus build, MCP, and web, following the README.
6. The test link stays free and live until 2026-11-10.

## 11. Open questions for the user

1. **Category bet:** go all-in on **Best Multi-Agent** (add A2A + live trace)? Or try Foundry / Cloud Native, which need a no-card Azure path such as Azure for Students on the CityU account?
2. **Is the seeded QA decoy acceptable?** The first draft is deliberately wrong so the retry always shows. Should we disclose it, or switch to a real LLM draft that QA catches naturally?
3. **Scope for the 6 remaining days:** one perfect moment, or a match strip with 3 moments plus a heat field?
4. **Live vs static:** should the site run agents live (needs a hosted backend and token), or stay static JSON with the trace replayed?
5. **Primary persona:** fan (game, modes) or producer (sign-off, export)? This decides the Enterprise story.
6. **Video:** keep silent with captions, or add an English TTS voice-over?
7. **Team / submission:** solo or team? Who submits, and through which portal (Innovation Studio was 404 on 10-20)?
