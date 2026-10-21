# Contest context: Microsoft × Premier League "Inside the Game" Developer Hackathon

Summary compiled 2026-10-21 from the official rules repo (github.com/microsoft/insidethegamehackathon: `OFFICIAL RULES.md`, `RESOURCE PLAYLISTS.md`) and internal research notes. Personal data has been removed. Check the official rules before acting on anything below.

## Key dates

| Event | Pacific | Asia/Shanghai (UTC+8) |
|---|---|---|
| Hacking period | 2026-10-06 09:00 PT – 2026-10-27 23:59 PT | — |
| Registration closed | 2026-10-20 12:00 PT | 2026-10-21 03:00 |
| **Submission deadline** | **2026-10-27 23:59 PT** | **2026-10-28 14:59** |
| Test access must stay free and working until | 2026-11-10 | — |

Registration status: registered (2026-10-20) via the Microsoft Events landing page. The Innovation Studio short link (aka.ms/insidethegame) returned 404 after sign-in on 10-20, so the submission path still needs to be confirmed.

## Challenge (§4.1)

Turn **synthetic** football events into explainable match intelligence through a 5-stage pipeline:

1. **Ingest** the event / tracking stream
2. **Interpret** with metrics and models
3. **Explain** in narratives
4. **Render** an on-screen overlay that is timed and machine-readable
5. **Personalize** for analyst vs casual fan, favorite club or player, language, single metric

Suggested features: player ID tagging, pass quality/difficulty, ball/shot speed, auto-eventing, narratives/recaps, explainability (control vs chaos, pressure, rhythm), synthetic data innovation, multi-language.

**No dataset is provided.** §4.7: projects must use synthetic, football-realistic data, and no footage may be redistributed.

## Submission requirements (§4.4)

- A project pitch that names the Microsoft / Azure technologies used
- A **demo video under 2 minutes**, publicly viewable (YouTube, Vimeo, etc.)
- A **public GitHub repository**
- **Working test access, free, until 2026-11-10**
- **English**
- A **new project** created after the registration start
- No copyrighted music and no third-party trademarks in the video (so no real PL crests, players, or footage)

## Judging (§6)

- **Stage 1 (pass/fail):** fits the theme and reasonably applies the required technologies.
- **Stage 2:** five criteria, 20% each. Ties are broken by the criteria in this order:
  1. **Technological Implementation**, including synthetic data creation. Hero tech: Microsoft Foundry, Microsoft Agent Framework, Azure MCP, GitHub Copilot Agent Mode, Microsoft Fabric, GitHub SDK/CLI, Azure Apps & AI Services, Azure databases.
  2. **Agentic Design & Innovation:** orchestration, MCP, multi-agent.
  3. **Real-World Impact**
  4. **UX & Presentation:** demo video, frontend/backend balance.
  5. **Category Adherence**

## Prizes (§4.2, §8)

- **Grand prize:** 1st and 2nd. The rules list 1st at $4k per person; other amounts were not re-verified.
- **Category prizes:**
  - Best Use of Microsoft Foundry
  - Best Enterprise Solution
  - **Best Multi-Agent System:** GitHub Copilot / Microsoft Agent Framework / A2A / other orchestration. Judged on distinct roles, shared state, handoffs, failure recovery, and an end-to-end outcome a single agent couldn't produce.
  - Best Azure Cloud Native Integration: AKS / ACA / Functions / Logic Apps, etc.
- At most 1 Grand + 1 Category prize per project.
- Cash is paid as a USD e-gift card per person.

## Eligibility and cost

- Free: "No purchase or payment necessary to enter or win."
- Individuals or teams of up to 4. Hong Kong is not in the excluded-country list.

## Our constraints

- **Never bind a credit card.** The Azure free trial needs a card, so it is not an option. Possible no-card routes: Azure for Students (unverified) or local Agent Framework plus our own MCP server on a free non-Azure host. Using only non-Azure services may cost the Foundry and Cloud Native categories.
- **Correction (2026-10-21):** GitHub Models (playground, catalog and inference) was retired on 2026-07-30 and is no longer a usable route; see https://docs.github.com/en/github-models. The project no longer references it in code.
- Everything in English (UI, video, repo). The Chinese mode is a feature, not burned-in video text.
- Video under 2 minutes, no music with rights issues, fictional clubs only.
- Public repo: github.com/er-s-an/other-pitch. Test link: https://other-pitch.vercel.app.
- Do not submit to Devpost / Innovation Studio or upload to YouTube without explicit user approval.

## Inspiration: AWS × NBA "Broadcast Code 12" (Zhuhai / Macau, 2026-10-10/11)

- A 12-hour offline hackathon on official NBA Inside the Game data and licensed footage (real data, unlike this contest).
- The champion and Best Visual winner was **平行世界 (Parallel World)**. In the post-goal replay window it played the 2 unchosen passes on a virtual court with probabilities, plus a gravity heat field and "ghost balls". It used a Director agent (verify-then-judge) over an AWS Step Functions pipeline: "judgment to agent, compute to pipeline, sign-off to human". Numbers were color-tagged by provenance.
- Another finalist, Deepdrink, built a "decision score" (shooter self-xPTS vs pass-to-open).
- A non-finalist got feedback of "AI architecture 91 / video 38", so the video weighs heavily.
- Rules for porting the idea: remixing the idea is fine, but the code must be new. Copy no code, names, visuals, footage, or Chinese voice-over, and credit the inspiration in the README.
- Public sources:
  - https://sspai.com/post/116205
  - https://benx.ai/blog/posts/nba-hackathon-parallel-world/
  - https://builder.aws.com/content/3Kcg7IbLpk8RZ1GA6hGwRcqzZqq/91-38-nba

## Ideas considered (2026-10-21)

1. **Second Director:** a multi-agent broadcast desk with overlay JSON plus per-audience recaps and a QA retry loop.
2. **Receipts FC:** live micro-quests for casual fans. Gambling optics are a risk.
3. **Scout Desk:** opposition reports with a critic agent, for an enterprise angle.

Chosen: **Other Pitch**. It is the 平行世界 port, and it absorbs the decision score (Deepdrink) and the QA/handoff loop from idea 1.
