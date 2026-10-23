import scenariosJson from "./data/scenarios.json";
import { OTHER, YOU, draw, framesAt, pxPerMetre, toPitch, VIEW_X0, type Route, type Highlight } from "./pitch";
import { DEFAULT_PARAMS, applyIntervention, clamp, offsideLine, type Params, type SAction, type SPlayer, type Snapshot, type XY, type Frame } from "./engine/engine";
import { display, evaluate, explain, type Evaluation } from "./engine/explain";

type Tool = "move" | "ball" | "add-def" | "add-att" | "remove";
const SCENES = (scenariosJson as unknown as { scenes: Record<string, Snapshot & { title: string; interventions: Array<{ variant_id: string; subject_id: string; after: XY }> }> }).scenes;

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const SLIDERS: Array<{ key: keyof Params; label: string; min: number; max: number; step: number; unit: string }> = [
  { key: "DEF_SPEED", label: "Defender speed", min: 3, max: 9, step: 0.5, unit: "m/s" },
  { key: "DEF_REACTION_S", label: "Defender reaction delay", min: 0, max: 1.2, step: 0.1, unit: "s" },
  { key: "BALL_SPEED", label: "Pass speed", min: 10, max: 24, step: 1, unit: "m/s" },
  { key: "RUN_SPEED", label: "Receiver run speed", min: 4, max: 9, step: 0.5, unit: "m/s" },
  { key: "SHOOT_RANGE_M", label: "Shooting range", min: 12, max: 26, step: 1, unit: "m" },
  { key: "RECYCLE_PRESSURE", label: "Pressure that stops a shot", min: 0.4, max: 1, step: 0.05, unit: "" },
];

const sb = {
  snap: null as Snapshot | null, params: { ...DEFAULT_PARAMS } as Params, overrides: [] as SAction[], source: "",
  ev: null as Evaluation | null, prev: null as Evaluation | null, selected: null as string | null,
  tool: "move" as Tool, drag: null as null | { id: string; moved: boolean; start: XY; base: Evaluation | null },
  timings: [] as number[], full: [] as number[], anim: null as null | { frames: Frame[]; start: number }, raf: 0, dirty: false, uid: 0,
};

const canvas = () => $<HTMLCanvasElement>("#sb-pitch");

// ---------------- state ----------------
function cloneSnap(s: Snapshot): Snapshot { return { scenario_id: s.scenario_id, carrier_id: s.carrier_id, key_defender_ids: [...(s.key_defender_ids ?? [])], players: s.players.map((p) => ({ ...p })), actions: [] }; }

export function loadScene(id: string, variant = "base") {
  const sc = SCENES[id];
  let snap = cloneSnap(sc);
  if (variant !== "base") { const iv = sc.interventions.find((i) => i.variant_id === variant); if (iv) snap = cloneSnap(applyIntervention(snap, iv.subject_id, iv.after)); }
  sb.snap = snap; sb.overrides = sc.actions.map((a) => ({ ...a })); sb.source = `${sc.title}${variant !== "base" ? " (lane closed)" : ""}`;
  sb.prev = null; sb.selected = null; recompute(true);
}

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
export function randomize(seed = Date.now() >>> 0) {
  const R = rng(seed), u = (a: number, b: number) => a + (b - a) * R();
  const ps: SPlayer[] = [{ id: "a1", team: "away", number: 1, name: "Peder Holm", role: "GK", x: 102, y: u(30, 38), vx: 0, vy: 0 }];
  const taken: XY[] = [];
  const free = (x: number, y: number) => taken.every(([a, b]) => Math.hypot(a - x, b - y) > 3.2);
  const place = (xa: number, xb: number, ya: number, yb: number): XY => { for (let i = 0; i < 60; i++) { const x = u(xa, xb), y = u(ya, yb); if (free(x, y)) { taken.push([x, y]); return [x, y]; } } const p: XY = [u(xa, xb), u(ya, yb)]; taken.push(p); return p; };
  const nd = 4 + Math.floor(R() * 3);
  const dnames = ["Malik Ferenc", "Owen Brant", "Jules Okada", "Cassian Doyle", "Ruth Abebe", "Hugo Marte", "Nina Pell"];
  for (let i = 0; i < nd; i++) { const [x, y] = place(80, 97, 8, 60); ps.push({ id: `a${i + 2}`, team: "away", number: i + 2, name: dnames[i], role: i < 2 ? "CB" : "DM", x, y, vx: u(-1, 0.5), vy: u(-0.5, 0.5) }); }
  const line = [...ps].map((p) => p.x).sort((a, b) => b - a)[1];
  const [cx, cy] = place(62, 80, 15, 53);
  ps.push({ id: "h8", team: "home", number: 8, name: "Idris Calder", role: "CM", x: cx, y: cy, vx: u(1.5, 3.5), vy: 0 });
  const an = [["h9", 9, "Sable Quinn", "ST"], ["h10", 10, "Leif Navarro", "RW"], ["h11", 11, "Hanae Solis", "LW"], ["h7", 7, "Remy Voss", "AM"]] as const;
  const na = 3 + Math.floor(R() * 2);
  for (let i = 0; i < na; i++) { const [x, y] = place(68, Math.max(70, line - 0.5), 5, 63); ps.push({ id: an[i][0], team: "home", number: an[i][1], name: an[i][2], role: an[i][3], x, y, vx: u(0.5, 4.5), vy: u(-1.5, 1.5) }); }
  sb.snap = { scenario_id: `random-${seed.toString(36)}`, carrier_id: "h8", players: ps, actions: [], key_defender_ids: [] };
  sb.overrides = []; sb.source = `Random legal setup #${seed.toString(36)}`; sb.selected = null;
  commit(); recompute(true);
}

function commit() { sb.prev = sb.ev; }

let liveT = 0;
let liveAnnounced = 0;
function markLive() {
  const wrap = document.querySelector(".sb-wrap");
  wrap?.classList.add("is-live");
  clearTimeout(liveT);
  if (sb.drag) return;
  const pip = document.querySelector("#sb-live");
  if (pip && performance.now() - liveAnnounced > 450) {
    pip.textContent = "Rankings updated";
    liveAnnounced = performance.now();
  }
  pip?.classList.add("on");
  liveT = window.setTimeout(() => { wrap?.classList.remove("is-live"); pip?.classList.remove("on"); }, 700);
}

function recompute(resetSel = false) {
  if (!sb.snap) return;
  const tStart = performance.now();
  const ev = evaluate(sb.snap, sb.params, sb.overrides);
  sb.ev = ev;
  sb.timings.push(ev.ms); if (sb.timings.length > 200) sb.timings.shift();
  if (resetSel || !sb.selected || !ev.branches[sb.selected]) sb.selected = ev.ranking[0] ?? null;
  sb.anim = null;
  renderPanel(); render();
  markLive();
  sb.full.push(performance.now() - tStart); if (sb.full.length > 200) sb.full.shift();
}

// ---------------- canvas ----------------
function staticFrame(): Frame {
  const p: Record<string, XY> = {};
  for (const q of sb.snap!.players) p[q.id] = [q.x, q.y];
  const c = sb.snap!.players.find((q) => q.id === sb.snap!.carrier_id);
  return { t: 0, ball: c ? [c.x + 0.6, c.y] : [52, 34], p };
}

function render() {
  const s = sb.snap, ev = sb.ev;
  if (!s) return;
  const analyst = document.body.dataset.mode === "analyst";
  let frame = staticFrame();
  if (sb.anim) frame = framesAt(sb.anim.frames, (performance.now() - sb.anim.start) / 1000);
  const routes: Route[] = [];
  const highlights: Highlight[] = [];
  let laneBand = null as null | { from: XY; to: XY };
  let zones: Array<{ at: XY; r: number }> = [];
  let targetIds: string[] = [];
  const keys = analyst ? (s.key_defender_ids ?? []) : (s.key_defender_ids ?? []).slice(0, 1);
  for (const id of keys) highlights.push({ id, label: id === keys[0] ? "Key" : "" });
  if (ev && !sb.anim) {
    const best = ev.ranking[0];
    if (analyst) {
      for (const id of [...ev.ranking].reverse()) {
        if (id === sb.selected) continue;
        const b = ev.branches[id];
        routes.push({ points: b.frames.map((f) => f.ball), color: id === best ? YOU : OTHER, dashed: true, label: "", alpha: id === best ? 0.8 : 0.4, width: id === best ? 2.2 : 1.5 });
      }
    } else if (best && best !== sb.selected && ev.branches[best]) {
      routes.push({ points: ev.branches[best].frames.map((f) => f.ball), color: YOU, dashed: true, label: "", alpha: 0.7, width: 2 });
    }
    if (sb.selected && ev.branches[sb.selected]) {
      const b = ev.branches[sb.selected], a = ev.actions.find((x) => x.action_id === sb.selected)!;
      routes.push({ points: b.frames.map((f) => f.ball), color: sb.selected === best ? YOU : OTHER, dashed: false, label: a.label, width: 3.6 });
      const blocker = b.inputs.blocking_defender_id as string | undefined;
      if (blocker && !highlights.some((h) => h.id === blocker) && (analyst || keys.length === 0)) highlights.push({ id: blocker, label: analyst ? "" : "Key" });
      if (a.receiver_id) targetIds = [a.receiver_id];
      if (analyst && a.type === "pass") laneBand = { from: frame.ball, to: a.target };
      if (analyst && blocker && frame.p[blocker]) zones = [{ at: frame.p[blocker], r: 6 }];
    }
  } else if (ev && sb.anim && sb.selected) {
    const b = ev.branches[sb.selected];
    const t = (performance.now() - sb.anim.start) / 1000;
    routes.push({ points: b.frames.filter((f) => f.t <= t).map((f) => f.ball), color: YOU, dashed: false, label: "One simulated possibility" });
    const a = ev.actions.find((x) => x.action_id === sb.selected);
    if (a?.receiver_id) targetIds = [a.receiver_id];
  }
  draw(canvas(), {
    frame, players: s.players, carrierId: s.carrier_id, routes, highlights, laneBand, zones, targetIds,
    arrows: sb.anim ? [] : s.players.filter((p) => p.team === "home").map((p) => ({ at: [p.x, p.y] as XY, v: [p.vx, p.vy] as XY })),
    selected: sb.drag?.id ?? null, offsideX: sb.anim ? null : offsideLine(s),
    caption: sb.anim ? `Decision + ${Math.min(8, (performance.now() - sb.anim.start) / 1000).toFixed(1)} s` : "Drag players · live recompute",
  });
  if (sb.anim) {
    const last = sb.anim.frames[sb.anim.frames.length - 1].t;
    if ((performance.now() - sb.anim.start) / 1000 < last + 0.6) sb.raf = requestAnimationFrame(render);
    else { sb.anim = null; render(); }
  }
}

function hit(ex: number, ey: number, pointerType = "mouse"): string | null {
  const [x, y] = toPitch(canvas(), ex, ey);
  const coarse = pointerType === "touch" || pointerType === "pen" || window.matchMedia("(pointer: coarse)").matches;
  const pxHit = coarse ? 30 : 22;
  const rad = Math.max(coarse ? 3.2 : 2.3, pxHit / Math.max(1, pxPerMetre(canvas())));
  let best: string | null = null, bd = rad;
  for (const p of sb.snap!.players) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p.id; } }
  const c = sb.snap!.players.find((p) => p.id === sb.snap!.carrier_id);
  if (c && Math.hypot(c.x + 0.6 - x, c.y - y) < bd * 0.7) best = c.id;
  return best;
}

function onDown(e: PointerEvent) {
  if (!sb.snap) return;
  if (e.cancelable) e.preventDefault();
  const r = canvas().getBoundingClientRect(), ex = e.clientX - r.left, ey = e.clientY - r.top;
  const id = hit(ex, ey, e.pointerType);
  const [x, y] = toPitch(canvas(), ex, ey);
  const inside = x >= VIEW_X0 && x <= 105 && y >= 0 && y <= 68;
  if (sb.tool === "add-def" || sb.tool === "add-att") {
    if (!inside) return;
    const team = sb.tool === "add-def" ? "away" : "home";
    const used = new Set(sb.snap.players.filter((p) => p.team === team).map((p) => p.number));
    let n = 2; while (used.has(n)) n++;
    const pid = `${team === "away" ? "a" : "h"}${n}x${++sb.uid}`;
    commit();
    sb.snap.players.push({ id: pid, team, number: n, name: `${team === "away" ? "Defender" : "Attacker"} ${n}`, role: team === "away" ? "CB" : "FW", x, y, vx: team === "home" ? 2 : 0, vy: 0 });
    recompute(); return;
  }
  if (!id) return;
  const p = sb.snap.players.find((q) => q.id === id)!;
  if (sb.tool === "remove") {
    if (id === sb.snap.carrier_id) { flash("The ball carrier cannot be removed. Give the ball to someone else first."); return; }
    commit(); sb.snap.players = sb.snap.players.filter((q) => q.id !== id); recompute(); return;
  }
  if (sb.tool === "ball") {
    if (p.team !== "home" || p.role === "GK") { flash("Only an attacking outfield player can have the ball."); return; }
    commit(); sb.snap.carrier_id = id; recompute(true); return;
  }
  try { canvas().setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
  document.body.classList.add("sb-dragging");
  dismissHint();
  sb.drag = { id, moved: false, start: [p.x, p.y], base: sb.ev };
}

function onMove(e: PointerEvent) {
  if (!sb.drag || !sb.snap) return;
  if (e.cancelable) e.preventDefault();
  const r = canvas().getBoundingClientRect();
  const [x, y] = toPitch(canvas(), e.clientX - r.left, e.clientY - r.top);
  const p = sb.snap.players.find((q) => q.id === sb.drag!.id)!;
  p.x = clamp(x, VIEW_X0 + 0.5, 104.5); p.y = clamp(y, 0.5, 67.5);
  sb.drag.moved = true;
  if (!sb.dirty) { sb.dirty = true; requestAnimationFrame(() => { sb.dirty = false; sb.prev = sb.drag?.base ?? sb.prev; recompute(); }); }
}

function onUp() {
  document.body.classList.remove("sb-dragging");
  if (!sb.drag) return;
  const d = sb.drag; sb.drag = null;
  if (d.moved) { sb.prev = d.base; recompute(); } else render();
}

let flashT = 0;
function flash(m: string) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(flashT); flashT = window.setTimeout(() => (t.hidden = true), 3500); }

// ---------------- panel ----------------
function deltaChip(now: number | null, before: number | null | undefined, kind: "pct" | "score") {
  if (before === undefined) return `<i class="d new">new</i>`;
  if (now == null || before == null) return "";
  const d = Math.round(now * 100) - Math.round(before * 100);
  if (d === 0) return `<i class="d">=</i>`;
  return `<i class="d ${d > 0 ? "up" : "down"}">${d > 0 ? "\u25B2" : "\u25BC"} ${Math.abs(d)}${kind === "pct" ? " pts" : ""}</i>`;
}

function p95() { const a = [...sb.timings].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.95))] : 0; }

function renderPanel() {
  const ev = sb.ev, s = sb.snap;
  $("#sb-source").textContent = sb.source || "Sandbox";
  if (!s || !ev) {
    $("#sb-perf").textContent = "Pick a starting play. Rankings appear after the first recompute.";
    $("#sb-rank").innerHTML = `<p>Nothing ranked yet.</p>`;
    $("#sb-explain").innerHTML = `<p>Drag a player once a play is loaded. Every move recomputes in the browser.</p>`;
    return;
  }
  const analyst = document.body.dataset.mode === "analyst";
  $("#sb-perf").innerHTML = `<span class="live-note">${ev.actions.length} actions recomputed.</span> <span class="tech"><b>${ev.ms.toFixed(2)} ms</b> \u00b7 p95 ${p95().toFixed(2)} ms over ${sb.timings.length} updates \u00b7 state <code>${esc(ev.state_hash)}</code></span>`;
  const list = $("#sb-rank");
  if (ev.legality.length || !ev.ranking.length) {
    const why = ev.legality.length ? `Not a legal state: ${ev.legality.join("; ")}` : "No legal action from this shape. Move a team-mate onside, or give the ball to an attacker.";
    list.innerHTML = `<p class="warn">${esc(why)}</p>`;
    $("#sb-explain").innerHTML = `<p>${esc(why)}</p>`;
    return;
  }
  const prev = sb.prev;
  list.innerHTML = ev.ranking.map((id, i) => {
    const b = ev.branches[id], a = ev.actions.find((x) => x.action_id === id)!;
    const pb = prev?.branches[id];
    const sameCarrier = prev && prev.actions.find((x) => x.action_id === id)?.actor_id === a.actor_id;
    const before = sameCarrier ? pb : undefined;
    return `<button type="button" class="rank ${id === sb.selected ? "on" : ""} ${i === 0 ? "best" : ""}" data-sel="${id}">
      <span class="n">${i + 1}</span><span class="lbl">${esc(a.label)}<small>${a.type === "shot" ? "Shot" : "Ground pass"}</small></span>
      <span class="v">${display("opportunity_value", b.metrics.opportunity_value)}${deltaChip(b.metrics.opportunity_value, prev ? (before ? before.metrics.opportunity_value : undefined) : null, "score")}</span>
      <span class="c">${b.metrics.p_complete == null ? "\u2014" : display("p_complete", b.metrics.p_complete)}${b.metrics.p_complete != null ? deltaChip(b.metrics.p_complete, prev ? (before ? before.metrics.p_complete : undefined) : null, "pct") : ""}</span>
      <span class="k">${display("p_lose_possession", b.metrics.p_lose_possession)}</span></button>`;
  }).join("") + (ev.unavailable.length ? `<p class="fine">Unavailable: ${esc(ev.unavailable.map((u) => u.reason).join("; "))}.</p>` : "");
  if (prev && prev.ranking[0] && ev.ranking[0] && prev.ranking[0] !== ev.ranking[0] && prev.actions[0]?.actor_id === ev.actions[0]?.actor_id) {
    const a0 = prev.actions.find((x) => x.action_id === prev.ranking[0])?.label, a1 = ev.actions.find((x) => x.action_id === ev.ranking[0])?.label;
    list.insertAdjacentHTML("afterbegin", `<p class="flip">Strongest route changed: ${esc(a0 ?? "")} \u2192 ${esc(a1 ?? "")}</p>`);
  }
  if (sb.selected) {
    const ex = explain(s, ev, sb.selected);
    const b = ev.branches[sb.selected];
    const ok = ex.qa.length === 0;
    const claims = ex.claims.filter((c) => c.action_id === sb.selected && (analyst || c.metric === "opportunity_value"));
    $("#sb-explain").innerHTML = ok ? `<h3>${esc(ex.headline)}</h3><p>${esc(ex.sentence)}</p>
      <dl class="claims">${claims.map((c) => `<div><dt>${esc(c.label)}</dt><dd>${esc(c.display_value)}</dd></div>`).join("")}</dl>
      <details class="defs"><summary>Outcome tree &amp; evidence</summary><ul class="tree">${b.leaves.map((l) => `<li><span>${esc(l.leaf_id.replace(/_/g, " "))}</span><span>p ${l.probability.toFixed(3)}</span><span>${l.shot_quality == null ? "no shot" : "q " + l.shot_quality.toFixed(3)}</span><span>${l.elapsed_s.toFixed(1)} s</span></li>`).join("")}</ul>
      <p class="fine">${ex.claims.map((c) => `<code>${esc(c.evidence_id)}</code>`).join(" ")}</p></details>
      <p class="qa-ok">QA: ${ex.claims.length} claims, each bound to a value computed for this exact state.</p>
      <button class="btn ghost" type="button" data-sbact="play">Play this branch</button>`
      : `<p class="warn">Explanation withheld: QA failed (${esc(ex.qa.join("; "))}).</p>`;
  }
}

function syncSliders() {
  $("#sb-params").innerHTML = SLIDERS.map((s) => `<label><span>${esc(s.label)} <b data-out="${s.key}">${sb.params[s.key]}${s.unit ? " " + s.unit : ""}</b></span>
    <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${sb.params[s.key]}" data-param="${s.key}" /></label>`).join("");
}

// ---------------- share ----------------
function b64u(s: string) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64u(s: string) { return decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))); }
const r2 = (v: number) => Math.round(v * 100) / 100;
export function encodeState(): string {
  const s = sb.snap!;
  const diff: Partial<Params> = {};
  for (const k of Object.keys(DEFAULT_PARAMS) as Array<keyof Params>) if (sb.params[k] !== DEFAULT_PARAMS[k]) diff[k] = sb.params[k];
  return b64u(JSON.stringify({ v: 1, c: s.carrier_id, src: sb.source, p: s.players.map((p) => [p.id, p.team === "home" ? 1 : 0, p.number, p.role, p.name, r2(p.x), r2(p.y), r2(p.vx), r2(p.vy)]), P: diff, o: sb.overrides }));
}
export function decodeState(str: string): boolean {
  try {
    const d = JSON.parse(unb64u(str));
    if (d.v !== 1 || !Array.isArray(d.p)) return false;
    const players: SPlayer[] = d.p.map((a: unknown[]) => ({ id: String(a[0]), team: a[1] ? "home" : "away", number: Number(a[2]), role: String(a[3]), name: String(a[4]).slice(0, 40), x: clamp(Number(a[5]), 0, 105), y: clamp(Number(a[6]), 0, 68), vx: clamp(Number(a[7]) || 0, -9, 9), vy: clamp(Number(a[8]) || 0, -9, 9) }));
    if (players.length > 30) return false;
    sb.snap = { scenario_id: "shared", carrier_id: String(d.c), players, actions: [], key_defender_ids: [] };
    sb.params = { ...DEFAULT_PARAMS };
    for (const k of Object.keys(d.P ?? {})) if (k in DEFAULT_PARAMS) (sb.params as unknown as Record<string, number>)[k] = Number(d.P[k]);
    sb.overrides = Array.isArray(d.o) ? d.o.filter((a: SAction) => a && (a.type === "pass" || a.type === "shot")) : [];
    sb.source = `Shared setup${d.src ? " \u00b7 from " + String(d.src).slice(0, 60) : ""}`;
    return true;
  } catch { return false; }
}

// ---------------- wiring ----------------
const TOOL_HINT: Record<Tool, string> = {
  move: "Drag a player. Rankings recompute on every move.",
  ball: "Tap an attacker to give them the ball. Rankings recompute immediately.",
  "add-def": "Tap open grass to add a defender.",
  "add-att": "Tap open grass to add an attacker.",
  remove: "Tap a player to remove them. Give the ball away before removing the carrier.",
};
const HINT_KEY = "otherpitch.sandbox.hint";
function dismissHint() {
  try { localStorage.setItem(HINT_KEY, "1"); } catch { /* ignore */ }
  const n = $("#sb-hint");
  if (n) n.hidden = true;
}
function syncHint() {
  let seen = false;
  try { seen = localStorage.getItem(HINT_KEY) === "1"; } catch { /* private mode: keep the hint */ }
  const n = $("#sb-hint");
  if (n) n.hidden = seen;
}
function syncTool() {
  const cv = canvas();
  cv.dataset.tool = sb.tool;
  const hint = $("#sb-tool-hint");
  if (hint) hint.textContent = TOOL_HINT[sb.tool];
  document.querySelectorAll("[data-tool]").forEach((x) => x.setAttribute("aria-pressed", String((x as HTMLElement).dataset.tool === sb.tool)));
}

export function initSandbox() {
  const cv = canvas();
  cv.style.touchAction = "none";
  cv.addEventListener("pointerdown", onDown, { passive: false });
  cv.addEventListener("pointermove", onMove, { passive: false });
  cv.addEventListener("pointerup", onUp);
  cv.addEventListener("pointercancel", onUp);
  cv.addEventListener("lostpointercapture", onUp);
  cv.addEventListener("touchmove", (e) => { if (sb.drag && e.cancelable) e.preventDefault(); }, { passive: false });
  new ResizeObserver(() => render()).observe(cv);
  syncTool();
  syncSliders();
  $("#sb-params").addEventListener("pointerdown", () => commit());
  $("#sb-params").addEventListener("keydown", () => commit());
  $("#sb-params").addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement; const k = t.dataset.param as keyof Params; if (!k) return;
    sb.params[k] = Number(t.value);
    const s = SLIDERS.find((x) => x.key === k)!;
    $(`[data-out="${k}"]`).textContent = `${sb.params[k]}${s.unit ? " " + s.unit : ""}`;
    recompute();
  });
  document.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
    if (!b) return;
    if (b.dataset.sel) { sb.selected = b.dataset.sel; renderPanel(); render(); }
    if (b.dataset.tool) { sb.tool = b.dataset.tool as Tool; syncTool(); }
    switch (b.dataset.sbact) {
      case "dismiss-hint": dismissHint(); break;
      case "random": randomize(); break;
      case "reset-params": commit(); sb.params = { ...DEFAULT_PARAMS }; syncSliders(); recompute(); break;
      case "play": if (sb.selected && sb.ev) { sb.anim = { frames: sb.ev.branches[sb.selected].frames, start: performance.now() }; cancelAnimationFrame(sb.raf); render(); } break;
      case "share": {
        const u = new URL(location.origin + location.pathname); u.searchParams.set("sb", encodeState());
        navigator.clipboard?.writeText(u.toString()).then(() => flash("Sandbox link copied. It encodes every position and parameter."), () => prompt("Copy this link", u.toString()));
        history.replaceState(null, "", u.toString());
        break;
      }
    }
  });
  $<HTMLSelectElement>("#sb-scene").addEventListener("change", (e) => { const [id, v] = (e.target as HTMLSelectElement).value.split(":"); commit(); loadScene(id, v); });
}

export function showSandbox() { syncHint(); syncTool(); render(); renderPanel(); }
export function hasState() { return !!sb.snap; }
export const sandboxState = sb;
export function sbRecompute() { recompute(true); }
