import "./style.css";
import { OTHER, YOU, draw, framesAt, hitTarget, type Route, type Highlight } from "./pitch";
import { initSandbox, loadScene as sbLoad, decodeState, showSandbox, hasState, randomize, sbRecompute, sandboxState } from "./sandbox";
import type { Branch, Bundle, Catalog, Explanation, Frame, Mode, Motion, Trace, XY } from "./types";

const DATA = "/data/v2";
const ROUNDS = ["central-lane", "open-not-safe", "close-call"];
const STORE = "otherpitch.v2.progress";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Phase = "intro" | "leadin" | "decide" | "branch" | "result" | "recap" | "error";
interface RoundRecord { scene: string; pick: string; recorded: string; top: string; focus: string; verdict: string; explored: string[]; variantSeen: string[] }

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const el = (tag: string, cls = "", html = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const cache = new Map<string, Promise<unknown>>();
function getJSON<T>(path: string): Promise<T> {
  if (!cache.has(path)) cache.set(path, fetch(`${DATA}/${path}`).then((r) => { if (!r.ok) throw new Error(`${r.status} ${path}`); return r.json(); }).catch((e) => { cache.delete(path); throw e; }));
  return cache.get(path) as Promise<T>;
}

const state = {
  mode: "casual" as Mode,
  phase: "intro" as Phase,
  round: 0,
  rounds: [] as RoundRecord[],
  catalog: null as Catalog | null,
  bundle: null as Bundle | null,
  variant: "base",
  pick: null as string | null,
  view: null as string | null,
  frames: [] as Frame[],
  t: 0,
  playing: false,
  token: 0,
  challenge: null as null | { scene: string; variant: string; pick: string | null },
  deltaFrom: null as Bundle | null,
  error: "" as string,
};

const canvas = $<HTMLCanvasElement>("#pitch");

// ---------------- helpers ----------------
function branch(id: string, b = state.bundle!): Branch { return b.branches.find((x) => x.action_id === id)!; }
function expl(id: string, b = state.bundle!): Explanation { return b.explanations[id]; }
function claim(e: Explanation, id: string) { return e.claims.find((c) => c.claim_id === id)!; }
function player(id: string | null) { return state.bundle!.players.find((p) => p.id === id); }
function surname(id: string | null) { const p = player(id); return p ? p.name.split(" ").slice(-1)[0] : ""; }
function top(b = state.bundle!) { return [...b.branches].sort((a, c) => c.metrics.opportunity_value - a.metrics.opportunity_value)[0]; }
function pct(v: number | null) { return v == null ? "n/a" : `${Math.round(v * 100)}%`; }
function score(v: number | null) { return v == null ? "n/a" : `${Math.round(v * 100)} / 100`; }
function roleOf(id: string) {
  if (id === state.pick) return "Your choice";
  if (id === state.bundle!.recorded_action_id) return "Recorded";
  return "Another option";
}
function save() { if (!state.challenge) localStorage.setItem(STORE, JSON.stringify({ round: state.round, rounds: state.rounds, mode: state.mode })); }

function ballPath(frames: Frame[], upto: number): XY[] { return frames.filter((f) => f.t <= upto + 1e-6).map((f) => f.ball); }
function offsideXOf(players: Array<{ team: string; x: number }>): number {
  const xs = players.filter((p) => p.team === "away").map((p) => p.x).sort((a, b) => b - a);
  return xs.length >= 2 ? xs[1] : 105;
}
function applyMode() {
  document.body.dataset.mode = state.mode;
  document.querySelectorAll("[data-mode]").forEach((m) => m.setAttribute("aria-pressed", String((m as HTMLElement).dataset.mode === state.mode)));
}
function busy(on: boolean, msg = "Loading… the last picture stays up.") {
  const n = $("#busy");
  if (!n) return;
  n.hidden = !on;
  if (on) n.textContent = msg;
}
function pitchStatus(show: boolean, text: string, retry: boolean) {
  const box = document.querySelector<HTMLElement>("#pitch-status");
  const label = document.querySelector("#pitch-status-text");
  const btn = document.querySelector<HTMLElement>("#pitch-retry");
  if (!box || !label || !btn) return;
  box.hidden = !show;
  if (show && text) label.textContent = text;
  btn.hidden = !retry;
}

// ---------------- rendering ----------------
function render() {
  const b = state.bundle;
  if (!b || !state.frames.length) {
    pitchStatus(true, state.phase === "error" ? "This play did not load." : "Loading the play…", state.phase === "error");
    return;
  }
  pitchStatus(false, "", false);
  const frame = framesAt(state.frames, state.t);
  const routes: Route[] = [];
  const highlights: Highlight[] = [];
  let targets: Array<{ id: string; at: XY; label: string; hot: boolean }> | undefined;
  if (state.phase === "decide") {
    targets = b.branches.map((x) => ({ id: x.action_id, at: (x.type === "shot" ? [103, 34] : x.target) as XY, label: x.label, hot: false, below: x.type === "shot" }));
  }
  if ((state.phase === "branch" || state.phase === "result") && state.view) {
    const mine = state.view === state.pick;
    routes.push({ points: ballPath(state.frames, state.t), color: mine ? YOU : OTHER, dashed: !mine,
      label: `${roleOf(state.view)} \u00b7 Simulated` });
  }
  const key = state.mode === "analyst" ? b.key_defender_ids : b.key_defender_ids.slice(0, 1);
  const showLabels = state.phase === "intro" || state.phase === "decide" || state.phase === "result";
  const iv = b.intervention;
  if (iv) highlights.push({ id: iv.subject_id, label: showLabels ? `${surname(iv.subject_id)} \u00b7 moved` : "", ghostFrom: iv.field_changes[0].before as XY });
  for (const k of key) {
    const existing = highlights.find((h) => h.id === k);
    const keyLabel = showLabels && k === key[0] ? `Key \u00b7 ${surname(k)}` : "";
    if (existing) { if (keyLabel && !existing.label.startsWith("Key")) existing.label = `Key \u00b7 ${existing.label}`; }
    else highlights.push({ id: k, label: keyLabel });
  }
  if (state.phase === "result" && state.view && state.mode === "analyst") {
    const br = branch(state.view);
    const blocker = br.inputs.blocking_defender_id as string | undefined;
    if (blocker && !highlights.some((h) => h.id === blocker)) highlights.push({ id: blocker, label: showLabels ? surname(blocker) : "" });
  }
  const targetIds = (state.phase === "intro" || state.phase === "decide")
    ? b.branches.map((x) => x.receiver_id).filter((id): id is string => !!id)
    : state.view && branch(state.view).receiver_id ? [branch(state.view).receiver_id as string] : [];
  let laneBand = null as null | { from: XY; to: XY };
  let zones: Array<{ at: XY; r: number }> = [];
  if (state.mode === "analyst" && state.view && state.phase === "result") {
    const br = branch(state.view);
    if (br.type === "pass") laneBand = { from: state.frames[0].ball, to: br.target };
    const blocker = br.inputs.blocking_defender_id as string | undefined;
    if (blocker && state.frames[0].p[blocker]) zones = [{ at: state.frames[0].p[blocker], r: 6 }];
  }
  const rel = state.t;
  const caption = state.phase === "leadin" ? `Approach \u00b7 ${rel.toFixed(1)} s` :
    state.phase === "intro" || state.phase === "decide" ? "Decision moment \u00b7 t = 0.0 s" :
    `Decision + ${rel.toFixed(1)} s`;
  const offsideX = state.phase === "intro" || state.phase === "decide" ? offsideXOf(b.players) : null;
  draw(canvas, { frame, players: b.players, carrierId: b.carrier_id, routes, highlights, targets, targetIds, laneBand, zones, caption, offsideX });
  $("#t-rel").textContent = caption;
}

let raf = 0;
function play(frames: Frame[], from: number, to: number, done: () => void) {
  cancelAnimationFrame(raf);
  state.frames = frames;
  if (reduceMotion) { state.t = to; render(); done(); return; }
  const start = performance.now(), dur = (to - from) * 1000;
  const token = state.token;
  state.playing = true;
  const step = (now: number) => {
    if (token !== state.token) return;
    const u = Math.min(1, (now - start) / dur);
    state.t = from + (to - from) * u;
    render();
    if (u < 1) raf = requestAnimationFrame(step); else { state.playing = false; done(); }
  };
  raf = requestAnimationFrame(step);
}

// ---------------- panels ----------------
function setPhase(p: Phase) {
  state.phase = p;
  document.body.dataset.phase = p;
  const cta = document.querySelector<HTMLElement>("#stage-cta");
  if (cta) cta.hidden = !(p === "intro" || p === "leadin");
  renderPanel();
  render();
}

function header() {
  const b = state.bundle!;
  $("#round-tag").textContent = state.challenge ? "Friend's challenge" : `Round ${state.round + 1} of ${ROUNDS.length}`;
  $("#scoreline").textContent = `${b.clock} \u00b7 ${b.teams.home.short} ${b.score.home}\u2013${b.score.away} ${b.teams.away.short}`;
  $("#scene-title").textContent = b.title;
  $("#scene-brief").textContent = b.brief;
  $("#variant-tag").textContent = b.variant_id === "base" ? "" : `Condition: ${b.intervention?.label}`;
  $("#variant-tag").hidden = b.variant_id === "base";
}

function metricRow(label: string, value: string, meaning: string) {
  return `<div class="metric"><p class="meaning">${esc(meaning)}</p><dd>${esc(value)}</dd><dt>${esc(label)}</dt></div>`;
}

function resultCard(): string {
  const b = state.bundle!, id = state.view!, e = expl(id), br = branch(id);
  const isMine = id === state.pick;
  const mode = state.mode;
  const text = mode === "casual" ? e.casual : e.analyst;
  let html = `<p class="role role-${isMine ? "you" : "other"}">${esc(roleOf(id))}: ${esc(br.label)}</p>`;
  html += `<h3 class="verdict">${esc(isMine ? text.headline : (e.verdict === "strongest" ? "This route was the strongest here." : text.headline))}</h3>`;
  html += `<p class="why">${esc(text.sentence)}</p>`;
  if (mode === "casual") {
    const ids = e.casual.metric_claim_ids.slice(0, 2);
    html += `<dl class="metrics">` + ids.map((cid) => {
      const c = claim(e, cid);
      const meaning = c.metric_name === "opportunity_value"
        ? "Synthetic chance score for the next 8 seconds. Not a goal probability."
        : c.metric_name === "p_complete"
          ? "Internal estimate that this pass reaches the team-mate."
          : c.label;
      return metricRow(c.label, c.display_value, meaning);
    }).join("") + `</dl>`;
    html += `<p class="fine">${esc(e.casual.uncertainty)} Synthetic scenario.</p>`;
  } else {
    const ranked = [...b.branches].sort((a, c) => c.metrics.opportunity_value - a.metrics.opportunity_value);
    const rank = Math.max(1, ranked.findIndex((x) => x.action_id === id) + 1);
    const rec = b.branches.find((x) => x.action_id === b.recorded_action_id);
    let versus = "";
    if (rec && rec.action_id !== id) {
      const dOpp = Math.round(br.metrics.opportunity_value * 100) - Math.round(rec.metrics.opportunity_value * 100);
      const dComp = br.metrics.p_complete != null && rec.metrics.p_complete != null
        ? Math.round(br.metrics.p_complete * 100) - Math.round(rec.metrics.p_complete * 100) : null;
      const opp = dOpp === 0 ? "opportunity =" : `${dOpp > 0 ? "\u25B2" : "\u25BC"} ${Math.abs(dOpp)} opportunity`;
      const comp = dComp == null ? "" : dComp === 0 ? " \u00b7 completion =" : ` \u00b7 ${dComp > 0 ? "\u25B2" : "\u25BC"} ${Math.abs(dComp)} completion`;
      versus = ` \u00b7 vs recorded: ${opp}${comp}`;
    } else if (rec) versus = " \u00b7 recorded action";
    html += `<p class="rankline">Rank ${rank} of ${ranked.length}${versus}</p>`;
    html += `<dl class="metrics metrics-dense">` + [
      metricRow("Opportunity quality", score(br.metrics.opportunity_value), "Weighted shot quality in the next 8 s. Not a goal probability."),
      metricRow("Estimated completion", pct(br.metrics.p_complete), "Chance the first pass reaches the team-mate."),
      metricRow("Possession risk", pct(br.metrics.p_lose_possession), "Share of the tree where the ball is lost first."),
      metricRow("Shot quality", score(br.metrics.q_shot), "Synthetic quality at the moment of the first shot."),
    ].join("") + `</dl>`;
    html += `<table class="mtable"><thead><tr><th>Action</th><th>Completion</th><th>Risk</th><th>Shot q</th><th>Opp.</th></tr></thead><tbody>`;
    for (const x of b.branches) {
      html += `<tr class="${x.action_id === id ? "on" : ""}"><td>${esc(x.label)}<small>${esc(roleOf(x.action_id))}</small></td><td>${pct(x.metrics.p_complete)}</td><td>${pct(x.metrics.p_lose_possession)}</td><td>${score(x.metrics.q_shot)}</td><td><b>${score(x.metrics.opportunity_value)}</b></td></tr>`;
    }
    html += `</tbody></table>`;
    html += `<h4>Outcome tree \u00b7 ${esc(br.label)}</h4><ul class="tree">` + br.outcome_tree.leaves.map((l) =>
      `<li><span>${esc(l.leaf_id.replace(/_/g, " "))}</span><span>p ${l.probability.toFixed(3)}</span><span>${l.shot_quality == null ? "no shot" : "q " + l.shot_quality.toFixed(3)}</span><span>${l.elapsed_s.toFixed(1)} s</span></li>`).join("") + `</ul>`;
    const inp = br.inputs;
    if (br.type === "pass") html += `<p class="fine">Inputs: pass ${Number(inp.pass_distance_m).toFixed(1)} m, lane block ${Number(inp.lane_block).toFixed(2)} (nearest: ${esc(surname(inp.blocking_defender_id as string))}), receiver pressure ${Number(inp.receiver_pressure_on_arrival).toFixed(2)}.</p>`;
    else html += `<p class="fine">Inputs: shot from ${Number(inp.shot_distance_m).toFixed(1)} m, pressure ${Number(inp.shot_pressure).toFixed(2)}.</p>`;
    html += `<p class="fine">Synthetic model ${esc(b.generation.engine_version)} · ${b.horizon_s} s window · not a goal probability.</p>`;
    html += `<details class="defs"><summary>Definitions, assumptions, evidence</summary><ul>` +
      Object.entries(b.metric_definitions).map(([k, d]) => `<li><b>${esc(d.label)}</b> (${esc(k)}, ${esc(d.unit)}): ${esc(d.definition)}</li>`).join("") +
      e.analyst.assumptions.map((a) => `<li>${esc(a)}</li>`).join("") +
      `<li>Evidence: ${e.claims.map((c) => `<code>${esc(c.evidence_id)}</code>`).join(" ")}</li></ul></details>`;
  }
  return html;
}

function compareTabs(): string {
  const b = state.bundle!;
  const order = [state.pick!, b.recorded_action_id, ...b.branches.map((x) => x.action_id)].filter((v, i, a) => a.indexOf(v) === i);
  return `<div class="tabs" role="tablist" aria-label="Compare routes from the same moment">` + order.map((id) =>
    `<button role="tab" type="button" data-view="${id}" aria-selected="${id === state.view}" class="tab ${id === state.pick ? "tab-you" : ""}"><span>${esc(roleOf(id))}${id === b.recorded_action_id && id === state.pick ? " \u00b7 Recorded" : ""}</span>${esc(branch(id).label)}</button>`).join("") + `</div>`;
}

function conditionBox(): string {
  const b = state.bundle!;
  const opts = b.available_interventions;
  if (!opts.length && b.variant_id === "base") return "";
  const ivs = opts.length ? opts : [];
  const label = ivs[0]?.label ?? b.intervention?.label ?? "";
  const on = b.variant_id !== "base";
  let delta = "";
  if (state.deltaFrom && state.view) {
    const prev = state.deltaFrom.branches.find((x) => x.action_id === state.view)!;
    const now = branch(state.view);
    const parts = [];
    if (now.metrics.p_complete != null) parts.push(`Completion ${pct(prev.metrics.p_complete)} \u2192 ${pct(now.metrics.p_complete)}`);
    parts.push(`Opportunity ${score(prev.metrics.opportunity_value)} \u2192 ${score(now.metrics.opportunity_value)}`);
    const t0 = top(state.deltaFrom).action_id, t1 = top().action_id;
    const rank = t0 === t1 ? `Strongest route unchanged: ${branch(t1).label}.` : `Strongest route changes: ${branch(t0, state.deltaFrom).label} \u2192 ${branch(t1).label}.`;
    delta = `<p class="delta"><b>${esc(branch(state.view).label)}:</b> ${esc(parts.join(" \u00b7 "))}. ${esc(rank)}</p>`;
  }
  return `<div class="condition"><p class="kicker">Change one condition</p>
    <div class="seg" role="group" aria-label="Defensive condition">
      <button type="button" data-variant="base" aria-pressed="${!on}">Base</button>
      <button type="button" data-variant="${esc(ivs[0]?.variant_id ?? b.variant_id)}" aria-pressed="${on}">${esc(label)}</button>
    </div>${delta}
    <p class="fine">Same moment, same rules. Only one defender's position changes. ${esc(b.generation.cache_status === "cached_validated_result" ? "Precomputed by the same engine and validated; loaded from cache." : "")}</p></div>`;
}

function renderPanel() {
  const panel = $("#panel");
  const b = state.bundle;
  panel.innerHTML = "";
  if (state.phase === "error") {
    $("#scene-title").textContent = b?.title ?? "Could not load";
    $("#scene-brief").textContent = b ? b.brief : "The catalogue or the play bundle did not load. Retry, or go back to the first play.";
    panel.append(el("div", "card", `<h3>Could not load this play.</h3><p>${esc(state.error || "The request failed. The previous picture stays up when one was already on screen.")}</p><div class="row"><button class="btn primary" type="button" data-act="retry">Retry</button><button class="btn ghost" type="button" data-act="restart">Back to the first play</button></div>`));
    return;
  }
  if (!b) {
    panel.append(el("div", "card", `<h3>Loading the play</h3><p>Fetching the validated bundle. This page does not pretend an agent is running.</p><div class="row"><button class="btn" type="button" data-act="retry">Retry</button></div>`));
    return;
  }
  header();
  if (state.phase === "intro") {
    panel.append(el("div", "card intro", `<p class="kicker">${state.round === 0 && !state.challenge ? "Your call" : "Next play"}</p>
      <h3>${esc(b.tactic)}</h3>
      <p>Watch three seconds of the attack, then decide what ${esc(surname(b.carrier_id))} should do. The panel ball is the one in black and white. A white ring is the carrier, a gold ring is a receiver, a red ring is the key defender.</p>
      <div class="row"><button class="btn primary" type="button" data-act="start">Start the play</button>
      <button class="btn ghost" type="button" data-act="skip">Skip to the decision</button>
      <button class="btn ghost" type="button" data-act="edit">Edit this play</button></div>`));
  } else if (state.phase === "leadin") {
    panel.append(el("div", "card", `<p class="kicker">Approach</p><h3>Watch the runs.</h3><button class="btn ghost" type="button" data-act="skip">Skip to the decision</button>`));
  } else if (state.phase === "decide") {
    const c = el("div", "card decide", `<p class="kicker">Decision \u00b7 t = 0.0 s</p><h3>What would you do?</h3><p>Pick a route, or tap a target on the pitch.</p>`);
    const list = el("div", "choices");
    for (const x of b.branches) {
      const btn = el("button", "choice", `<span>${esc(x.label)}</span><small>${x.type === "shot" ? "Shot" : "Ground pass to " + esc(surname(x.receiver_id))}</small>`) as HTMLButtonElement;
      btn.type = "button"; btn.dataset.pick = x.action_id;
      list.append(btn);
    }
    c.append(list);
    if (state.challenge?.pick) c.append(el("p", "fine", "Your friend already chose. You will see their pick after yours."));
    panel.append(c);
  } else if (state.phase === "branch") {
    panel.append(el("div", "card", `<p class="kicker">${esc(roleOf(state.view!))} \u00b7 one simulated possibility</p><h3>${esc(branch(state.view!).label)}</h3><p>Playing the branch your choice creates.</p>`));
  } else if (state.phase === "result") {
    const card = el("div", "card result");
    card.innerHTML = compareTabs() + `<div class="result-body" aria-live="polite">${resultCard()}</div>` + conditionBox();
    if (state.challenge?.pick) {
      card.append(el("p", "friend", `Your friend chose <b>${esc(branch(state.challenge.pick).label)}</b>. You chose <b>${esc(branch(state.pick!).label)}</b>.`));
    }
    const row = el("div", "row");
    row.innerHTML = `<button class="btn ghost" type="button" data-act="replay">Replay</button>
      <button class="btn ghost" type="button" data-act="share">Challenge a friend</button>
      <button class="btn ghost" type="button" data-act="edit">Edit this play</button>
      <button class="btn primary" type="button" data-act="next">${state.challenge ? "Play the full challenge" : state.round + 1 < ROUNDS.length ? "Next play" : "See your recap"}</button>`;
    card.append(row);
    panel.append(card);
  } else if (state.phase === "recap") {
    renderRecap(panel);
  }
}

const TAKEAWAY: Record<string, string> = {
  receiver_space: "Look for the run before the lane closes.",
  lane_blocked: "Free receiver, blocked path: the danger is on the way there.",
  close_tradeoff: "Two close options: a good choice can still fail.",
  shot_quality: "Where and under how much pressure the shot happens decides its quality.",
  insufficient_evidence: "Not enough evidence to explain this one.",
};

function renderRecap(panel: HTMLElement) {
  const c = el("div", "card recap");
  c.innerHTML = `<p class="kicker">Recap</p><h3>Three calls, three tactical ideas.</h3>`;
  const ol = el("ol", "recap-list");
  for (const r of state.rounds) {
    ol.append(el("li", "", `<b>${esc(r.scene.replace(/-/g, " "))}</b><span>You: ${esc(r.pick.replace(/_/g, " "))}</span><span>Recorded: ${esc(r.recorded.replace(/_/g, " "))}</span><span>Strongest in model: ${esc(r.top.replace(/_/g, " "))}</span><em>${esc(TAKEAWAY[r.focus] ?? "")}</em>`));
  }
  c.append(ol);
  const lean = state.rounds.filter((r) => r.pick.startsWith("shoot")).length;
  c.append(el("p", "fine", `In these three plays you shot ${lean} time${lean === 1 ? "" : "s"}. Three plays only show this session's tendency, not your skill.`));
  c.append(el("div", "row", `<button class="btn ghost" type="button" data-act="share-recap">Copy challenge link</button><button class="btn ghost" type="button" data-act="restart">Play again</button><button class="btn primary" type="button" data-app="sandbox">Open the Sandbox</button>`));
  panel.append(c);
}

// ---------------- flow ----------------
async function loadScene(scene: string, variant: string, keepView = false) {
  const token = ++state.token;
  const prev = state.bundle;
  busy(true, prev ? "Loading this condition… the last picture stays up." : "Loading the play…");
  try {
    const b = await getJSON<Bundle>(`${scene}/${variant}/bundle.json`);
    if (token !== state.token) return;
    state.deltaFrom = keepView && prev && prev.scene_id === scene && prev.variant_id !== variant ? prev : null;
    state.bundle = b;
    state.variant = variant;
    state.error = "";
    return b;
  } catch (e) {
    if (token !== state.token) return;
    state.error = `The validated bundle for this play did not load (${(e as Error).message}). The previous screen is kept.`;
    if (!prev) setPhase("error");
    else { state.bundle = prev; toast(state.error); render(); }
    return undefined;
  } finally {
    if (token === state.token) busy(false);
  }
}

async function showView(id: string) {
  const b = state.bundle!;
  const token = ++state.token;
  busy(true, "Loading this route… the last picture stays up.");
  let m: Motion;
  try { m = await getJSON<Motion>(`${b.scene_id}/${b.variant_id}/${branch(id).frames_ref}`); }
  catch (e) {
    if (token !== state.token) return;
    busy(false);
    toast(`This route did not load (${(e as Error).message}). The previous picture stays on the pitch.`);
    return;
  }
  if (token !== state.token) return;
  busy(false);
  state.view = id;
  setPhase(state.phase === "result" ? "result" : "branch");
  const end = m.frames[m.frames.length - 1].t;
  play(m.frames, 0, end, () => { if (state.phase === "branch") afterBranch(); else render(); });
}

function afterBranch() {
  const b = state.bundle!;
  const rec = state.rounds[state.round];
  if (!state.challenge && rec) { if (!rec.explored.includes(state.view!)) rec.explored.push(state.view!); save(); }
  setPhase("result");
  void b;
}

async function beginRound() {
  const scene = state.challenge ? state.challenge.scene : ROUNDS[state.round];
  const b = await loadScene(scene, state.challenge?.variant ?? "base");
  if (!b) return;
  state.pick = null; state.view = null; state.deltaFrom = null;
  state.frames = b.leadin.frames.concat([{ t: 0, ball: b.leadin.frames[b.leadin.frames.length - 1].ball, p: Object.fromEntries(b.players.map((p) => [p.id, [p.x, p.y] as XY])) }]);
  state.t = 0;
  setPhase("intro");
  loadTrace();
}

function startLeadin() {
  const b = state.bundle;
  if (!b) return;
  setPhase("leadin");
  play(state.frames, b.leadin.frames[0].t, 0, () => setPhase("decide"));
}

function choose(id: string) {
  if (state.phase !== "decide") return;
  const b = state.bundle!;
  state.pick = id;
  if (!state.challenge) {
    state.rounds[state.round] = { scene: b.scene_id, pick: id, recorded: b.recorded_action_id, top: top().action_id, focus: b.focus, verdict: expl(id).verdict, explored: [], variantSeen: [b.variant_id] };
    save();
  }
  void showView(id);
}

async function setVariant(v: string) {
  if (!state.bundle || v === state.bundle.variant_id || !state.view) return;
  const prev = state.bundle;
  const view = state.view;
  const token = ++state.token;
  busy(true, "Loading this condition… the last picture stays up.");
  try {
    const b = await getJSON<Bundle>(`${prev.scene_id}/${v}/bundle.json`);
    if (token !== state.token) return;
    const br = b.branches.find((x) => x.action_id === view);
    if (!br) throw new Error("that route is not in this condition");
    const m = await getJSON<Motion>(`${prev.scene_id}/${v}/${br.frames_ref}`);
    if (token !== state.token) return;
    busy(false);
    state.deltaFrom = prev;
    state.bundle = b;
    state.variant = v;
    state.view = view;
    state.error = "";
    state.t = 0;
    state.frames = m.frames;
    const rec = state.rounds[state.round];
    if (rec && !rec.variantSeen.includes(v)) { rec.variantSeen.push(v); save(); }
    setPhase("result");
    const end = m.frames[m.frames.length - 1].t;
    play(m.frames, 0, end, () => render());
  } catch (e) {
    if (token !== state.token) return;
    busy(false);
    state.bundle = prev;
    toast(`This condition did not load (${(e as Error).message}). The previous picture stays up.`);
  }
}

function shareURL(scene: string, pick: string | null) {
  const b = state.bundle!;
  const u = new URL(location.origin + location.pathname);
  u.searchParams.set("challenge", scene);
  u.searchParams.set("v", b.scenario_version);
  u.searchParams.set("variant", "base");
  if (pick) u.searchParams.set("pick", pick);
  return u.toString();
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast("Challenge link copied. Your pick stays hidden until they choose."); }
  catch { prompt("Copy this challenge link", text); }
}

let toastTimer = 0;
function toast(msg: string) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => (t.hidden = true), 4200);
}

// ---------------- under the hood ----------------
async function loadTrace() {
  const b = state.bundle!;
  const box = $("#hood-run");
  try {
    const tr = await getJSON<Trace>(`${b.scene_id}/${b.variant_id}/trace.json`);
    box.innerHTML = traceHTML(tr, b);
  } catch { box.textContent = "Trace not available."; }
}

function traceHTML(tr: Trace, b?: Bundle) {
  const steps = tr.steps.map((s) => `<li><b>${esc(s.agent.replace(/_/g, " "))}</b> <code>${esc(s.intent)}</code></li>`).join("");
  const calls = tr.tool_calls.map((c) => `<li><code>${esc(c.tool)}</code> by ${esc(c.agent.replace(/_/g, " "))} <small>${esc(JSON.stringify(c.args).slice(0, 80))} \u00b7 ${c.ms} ms</small></li>`).join("");
  return `<p class="fine">Run <code>${esc(tr.run_id)}</code> \u00b7 ${esc(tr.framework_package)} \u00b7 explainer: <code>${esc(tr.actual_model_ids.explainer)}</code> \u00b7 QA: <b>${esc(tr.qa_status)}</b>${b ? ` \u00b7 generated ${esc(b.generation.generated_at)} (producer generation, served from cache)` : ""}</p>
    <div class="hood-cols"><div><h4>Workflow steps</h4><ol class="steps">${steps}</ol></div><div><h4>MCP tool calls (${tr.tool_calls.length})</h4><ol class="calls">${calls}</ol></div></div>`;
}

async function runDiagnostic() {
  const box = $("#hood-diag");
  box.innerHTML = "Loading the diagnostic run\u2026";
  try {
    const tr = await getJSON<Trace>("diagnostics/fault-injection-trace.json");
    const rej = tr.steps.find((s) => s.intent === "claim_rejected");
    const errs = rej ? Object.values((rej.detail as { errors: Record<string, string[]> }).errors).flat() : [];
    box.innerHTML = `<p class="diag-label">Diagnostic test. A wrong-subject claim was injected on purpose; normal runs do not do this.</p>
      <ul class="errs">${errs.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` + traceHTML(tr);
  } catch (e) { box.textContent = `Diagnostic trace did not load: ${(e as Error).message}`; }
}

async function loadHeldout() {
  const box = $("#hood-heldout");
  try {
    const b = await getJSON<Bundle>("heldout-01/base/bundle.json");
    box.innerHTML = `<p class="fine">${esc(b.brief)} QA: <b>${esc(b.validation.qa_status)}</b> \u00b7 run <code>${esc(b.generation.run_id)}</code></p><table class="mtable"><thead><tr><th>Action</th><th>Completion</th><th>Possession risk</th><th>Opportunity</th><th>Generated sentence</th></tr></thead><tbody>` +
      b.branches.map((x) => `<tr><td>${esc(x.label)}</td><td>${pct(x.metrics.p_complete)}</td><td>${pct(x.metrics.p_lose_possession)}</td><td>${score(x.metrics.opportunity_value)}</td><td>${esc(b.explanations[x.action_id].casual.sentence)}</td></tr>`).join("") + `</tbody></table>`;
  } catch { box.textContent = "Held-out bundle not available."; }
}

// ---------------- events ----------------
document.addEventListener("click", (ev) => {
  const t = (ev.target as HTMLElement).closest("button") as HTMLButtonElement | null;
  if (!t) return;
  if (t.dataset.app) { if (t.dataset.app === "sandbox" && !hasState()) sbLoad("central-lane"); setApp(t.dataset.app as "tutorial" | "sandbox"); return; }
  if (t.dataset.sel || t.dataset.tool || t.dataset.sbact) return;
  if (t.dataset.pick) choose(t.dataset.pick);
  else if (t.dataset.view) void showView(t.dataset.view);
  else if (t.dataset.variant) void setVariant(t.dataset.variant);
  else if (t.dataset.mode) { state.mode = t.dataset.mode as Mode; applyMode(); save(); renderPanel(); render(); showSandbox(); }
  else switch (t.dataset.act) {
    case "start": startLeadin(); break;
    case "skip": state.token++; state.t = 0; setPhase("decide"); break;
    case "replay": if (state.view) void showView(state.view); break;
    case "share": void copy(shareURL(state.bundle!.scene_id, state.pick)); break;
    case "share-recap": void copy(shareURL(ROUNDS[0], state.rounds[0]?.pick ?? null)); break;
    case "next":
      if (state.challenge) { state.challenge = null; history.replaceState(null, "", location.pathname); state.round = 0; state.rounds = []; void beginRound(); }
      else if (state.round + 1 < ROUNDS.length) { state.round++; save(); void beginRound(); }
      else { state.round = ROUNDS.length; save(); setPhase("recap"); }
      break;
    case "restart": localStorage.removeItem(STORE); state.round = 0; state.rounds = []; void beginRound(); break;
    case "retry": void retryLoad(); break;
    case "diag": void runDiagnostic(); break;
    case "edit":
      if (!state.bundle) { toast("The play is still loading."); break; }
      sbLoad(state.bundle.scene_id, state.bundle.variant_id); setApp("sandbox"); break;
  }
});

canvas.addEventListener("click", (ev) => {
  if (state.phase !== "decide" || !state.bundle) return;
  const r = canvas.getBoundingClientRect();
  const id = hitTarget(canvas, state.bundle.branches.map((b) => ({ id: b.action_id, at: (b.type === "shot" ? [103, 34] : b.target) as XY })), ev.clientX - r.left, ev.clientY - r.top);
  if (id) choose(id);
});

new ResizeObserver(() => render()).observe(canvas);

// ---------------- boot ----------------
declare global { interface Window { __op: unknown } }
(window as Window).__op = state;
(window as unknown as { __sb: unknown }).__sb = sandboxState;

function setApp(app: "tutorial" | "sandbox") {
  document.querySelectorAll("[data-app]").forEach((b) => b.closest(".app-seg") && b.setAttribute("aria-pressed", String((b as HTMLElement).dataset.app === app)));
  ($(".game") as HTMLElement).hidden = app !== "tutorial";
  $("#sandbox").hidden = app !== "sandbox";
  document.body.dataset.app = app;
  if (app === "sandbox") { showSandbox(); window.scrollTo({ top: 0 }); }
}

async function retryLoad() {
  const keep = !!(state.bundle && state.frames.length);
  if (!keep) pitchStatus(true, "Loading the play…", false);
  else busy(true, "Loading the play… the last picture stays up.");
  if (!state.catalog) {
    try {
      state.catalog = await getJSON<Catalog>("scenes.json");
      $("#engine").textContent = `${state.catalog.engine_version} \u00b7 generated ${state.catalog.generated_at.slice(0, 10)}`;
    } catch (e) {
      state.error = `Scene catalogue did not load (${(e as Error).message}).`;
      setPhase("error");
      return;
    }
  }
  await beginRound();
}

async function boot() {
  applyMode();
  initSandbox();
  const sbq = new URLSearchParams(location.search).get("sb");
  if (sbq) { if (decodeState(sbq)) { setApp("sandbox"); showSandbox(); sbRecompute(); } else toast("That sandbox link could not be read. Here is the first play."); }
  if (new URLSearchParams(location.search).get("random")) { randomize(Number(new URLSearchParams(location.search).get("random")) || undefined); setApp("sandbox"); }
  try { state.catalog = await getJSON<Catalog>("scenes.json"); }
  catch (e) { state.error = `Scene catalogue did not load (${(e as Error).message}).`; setPhase("error"); return; }
  $("#engine").textContent = `${state.catalog.engine_version} \u00b7 generated ${state.catalog.generated_at.slice(0, 10)}`;
  const q = new URLSearchParams(location.search);
  const ch = q.get("challenge");
  if (ch) {
    const sc = state.catalog.scenes.find((s) => s.scene_id === ch && !s.heldout);
    const variant = q.get("variant") ?? "base";
    if (!sc || !sc.variants.some((v) => v.variant_id === variant)) toast("That challenge is not available. Here is the current play.");
    else {
      if (q.get("v") && q.get("v") !== sc.scenario_version) toast("This challenge was made for an older version of the play. Your answer will not count as the same challenge.");
      let pickOk = false;
      try {
        pickOk = !!(q.get("pick") && (await getJSON<Bundle>(`${ch}/${variant}/bundle.json`)).branches.some((b) => b.action_id === q.get("pick")));
        state.challenge = { scene: ch, variant, pick: pickOk ? q.get("pick") : null };
      } catch (e) { toast(`That challenge did not load (${(e as Error).message}). Here is the current play.`); }
    }
  } else {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null");
      if (saved && Array.isArray(saved.rounds)) { state.rounds = saved.rounds; state.round = Math.min(saved.round, ROUNDS.length); state.mode = saved.mode ?? "casual"; }
    } catch { /* ignore */ }
  }
  applyMode();
  void loadHeldout();
  if (state.round >= ROUNDS.length && !state.challenge) { state.round = ROUNDS.length - 1; await beginRound(); state.round = ROUNDS.length; setPhase("recap"); return; }
  await beginRound();
  if (state.rounds.length && state.round > 0 && !state.challenge) toast(`Welcome back. Resuming at round ${state.round + 1}. Use Play again in the recap to restart.`);
}
void boot();
