// Browser port of otherpitch/v2/simulation.py + analytics.py. Same math, same order of operations.
// Parity with the Python engine is checked by tests/parity.ts.

export const L = 105, W = 68, GOAL_X = 105, GOAL_Y = 34, GOAL_HALF = 3.66;
export const HORIZON_S = 8.0;
export const ENGINE_VERSION = "toy-v2.0";

export interface Params {
  DT: number; BALL_SPEED: number; RUN_SPEED: number; DEF_SPEED: number; DEF_REACTION_S: number; CONTROL_S: number;
  SHOT_WINDUP_S: number; CARRY_SPEED: number; SHOOT_RANGE_M: number; RECYCLE_PRESSURE: number;
}
export const DEFAULT_PARAMS: Params = {
  DT: 0.1, BALL_SPEED: 16, RUN_SPEED: 7, DEF_SPEED: 6, DEF_REACTION_S: 0.4, CONTROL_S: 0.6,
  SHOT_WINDUP_S: 0.3, CARRY_SPEED: 5, SHOOT_RANGE_M: 18, RECYCLE_PRESSURE: 0.85,
};

export interface SPlayer { id: string; team: "home" | "away"; number: number; name: string; role: string; x: number; y: number; vx: number; vy: number }
export interface SAction { action_id: string; type: "pass" | "shot"; actor_id: string; receiver_id: string | null; target: [number, number]; label: string }
export interface Snapshot { scenario_id: string; carrier_id: string; players: SPlayer[]; actions: SAction[]; key_defender_ids?: string[] }
export type XY = [number, number];
export interface Frame { t: number; ball: XY; p: Record<string, XY> }
export interface Leaf {
  leaf_id: string; end_reason: "shot" | "turnover" | "timeout"; probability: number; elapsed_s: number;
  shot_quality: number | null; initial_pass_completed: boolean | null; possession_lost: boolean;
}
export interface Metrics { p_complete: number | null; p_lose_possession: number; q_shot: number | null; opportunity_value: number }
export interface BranchResult {
  action_id: string; metrics: Metrics; inputs: Record<string, number | string | null>;
  leaves: Leaf[]; leaf: string; frames: Frame[]; events: Array<{ t: number; type: string; [k: string]: unknown }>;
}

// ---------- analytics.py ----------
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export function sigmoid(z: number) { if (z >= 0) { const e = Math.exp(-z); return 1 / (1 + e); } const e = Math.exp(z); return e / (1 + e); }
export function goalAngle(x: number, y: number, gx: number) {
  const v1 = [gx - x, GOAL_Y - GOAL_HALF - y], v2 = [gx - x, GOAL_Y + GOAL_HALF - y];
  const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
  if (n1 < 1e-6 || n2 < 1e-6) return 0;
  return Math.acos(clamp((v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2), -1, 1));
}
export function expectedGoals(x: number, y: number, gx: number, pressure: number) {
  const a = goalAngle(x, y, gx), d = Math.hypot(gx - x, GOAL_Y - y);
  return clamp(sigmoid(-0.35 + 3.45 * a - 0.098 * d - 1.5 * clamp(pressure, 0, 1)), 0.005, 0.95);
}
export function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const abx = bx - ax, aby = by - ay, ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-9) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / ab2, 0, 1);
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}
export function laneBlock(ax: number, ay: number, bx: number, by: number, opp: XY[]) {
  if (!opp.length) return 0;
  const c = Math.min(...opp.map(([ox, oy]) => pointSegDist(ox, oy, ax, ay, bx, by)));
  return clamp(1 - c / 6, 0, 1);
}
export function pressureAt(x: number, y: number, opp: XY[], radius = 8) {
  if (!opp.length) return 0;
  let acc = 0;
  for (const [ox, oy] of opp) { const d = Math.hypot(ox - x, oy - y); if (d < radius) acc += (1 - d / radius) ** 2; }
  return clamp(acc / 2.2, 0, 1);
}
export function passCompletion(dist: number, lane: number, pressure: number) {
  return clamp(sigmoid(3.2 - 0.055 * dist - 2.55 * lane - 1.25 * pressure), 0.02, 0.97);
}

// ---------- helpers ----------
const r = (v: number, n: number) => { const f = 10 ** n; return Math.round(v * f) / f; };
function pyRoundInt(v: number) { const f = Math.floor(v), d = v - f; if (Math.abs(d - 0.5) < 1e-12) return f % 2 === 0 ? f : f + 1; return Math.round(v); }
function stepToward(x: number, y: number, tx: number, ty: number, speed: number, dt: number): XY {
  const d = Math.hypot(tx - x, ty - y);
  if (d < 1e-6) return [tx, ty];
  const s = Math.min(d, speed * dt);
  return [x + ((tx - x) / d) * s, y + ((ty - y) / d) * s];
}
function closestOnSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number, number] {
  const abx = bx - ax, aby = by - ay, ab2 = abx * abx + aby * aby || 1e-9;
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / ab2, 0, 1);
  return [ax + t * abx, ay + t * aby, t];
}
const pyCmp = (a: [number, string], b: [number, string]) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);

class World {
  ps: SPlayer[]; by: Record<string, SPlayer>; ball: XY; t = 0; frames: Frame[] = []; events: BranchResult["events"] = [];
  constructor(snap: Snapshot, public P: Params) {
    this.ps = snap.players.map((p) => ({ ...p }));
    this.by = Object.fromEntries(this.ps.map((p) => [p.id, p]));
    const c = this.by[snap.carrier_id];
    this.ball = [c.x + 0.6, c.y];
  }
  opponents(): XY[] { return this.ps.filter((p) => p.team === "away").map((p) => [p.x, p.y]); }
  record() {
    const p: Record<string, XY> = {};
    for (const q of this.ps) p[q.id] = [r(q.x, 2), r(q.y, 2)];
    this.frames.push({ t: r(this.t, 2), ball: [r(this.ball[0], 2), r(this.ball[1], 2)], p });
  }
  drift(skip: Set<string>) {
    const dt = this.P.DT;
    for (const p of this.ps) {
      if (skip.has(p.id)) continue;
      p.x = clamp(p.x + p.vx * dt, 0, L); p.y = clamp(p.y + p.vy * dt, 0, W);
      p.vx *= 0.97; p.vy *= 0.97;
    }
  }
  press(tx: number, ty: number, reactFrom: number, ids: Set<string>) {
    if (this.t < reactFrom) return;
    for (const p of this.ps) {
      if (p.team !== "away" || p.role === "GK" || !ids.has(p.id)) continue;
      [p.x, p.y] = stepToward(p.x, p.y, tx, ty, this.P.DEF_SPEED, this.P.DT);
    }
  }
  tick() { this.t = r(this.t + this.P.DT, 6); this.record(); }
}

function nearestAway(w: World, x: number, y: number, n = 2): string[] {
  return w.ps.filter((p) => p.team === "away" && p.role !== "GK")
    .map((p) => [Math.hypot(p.x - x, p.y - y), p.id] as [number, string]).sort(pyCmp).slice(0, n).map((a) => a[1]);
}

function shoot(w: World, sid: string, pressers: Set<string>): [number, number, number] {
  const s = w.by[sid], P = w.P;
  const end = w.t + P.SHOT_WINDUP_S;
  const skip = new Set([...pressers, sid]);
  while (w.t < end - 1e-9 && w.t < HORIZON_S - 1e-9) {
    w.press(s.x, s.y, 0, pressers); w.drift(skip); w.ball = [s.x + 0.6, s.y]; w.tick();
  }
  const pressure = pressureAt(s.x, s.y, w.opponents());
  const q = expectedGoals(s.x, s.y, GOAL_X, pressure);
  w.events.push({ t: r(w.t, 2), type: "shot", player_id: sid, x: r(s.x, 2), y: r(s.y, 2), pressure: r(pressure, 4) });
  for (let i = 0; i < 6; i++) { w.ball = stepToward(w.ball[0], w.ball[1], GOAL_X, 34, 24, P.DT); w.drift(new Set([sid])); w.tick(); }
  return [q, pressure, r(w.t - 0.6, 2)];
}

function timeout(w: World, rid: string, why: string) {
  while (w.t < HORIZON_S - 1e-9) { if (w.t > 3.5) break; w.drift(new Set([rid])); w.tick(); }
  w.events.push({ t: r(w.t, 2), type: "no_shot", player_id: rid, note: why });
  return { end_reason: "timeout" as const, elapsed_s: HORIZON_S, q: null as number | null };
}

function playPass(w: World, a: SAction, flight: number, rx: number, ry: number) {
  const P = w.P, rid = a.receiver_id!, recv = w.by[rid];
  w.events.push({ t: 0, type: "pass", from: a.actor_id, to: rid, target: [rx, ry] });
  const pressers = new Set(nearestAway(w, rx, ry, 2));
  const skip = new Set([...pressers, rid]);
  while (w.t < flight - 1e-9) {
    w.ball = stepToward(w.ball[0], w.ball[1], rx, ry, P.BALL_SPEED, P.DT);
    [recv.x, recv.y] = stepToward(recv.x, recv.y, rx, ry, P.RUN_SPEED, P.DT);
    w.press(rx, ry, P.DEF_REACTION_S, pressers); w.drift(skip); w.tick();
  }
  w.ball = [rx, ry]; recv.x = rx; recv.y = ry;
  const receipt = pressureAt(rx, ry, w.opponents());
  w.events.push({ t: r(w.t, 2), type: "receive", player_id: rid });
  const end = w.t + P.CONTROL_S;
  while (w.t < end - 1e-9) { w.press(recv.x, recv.y, 0, pressers); w.drift(skip); w.tick(); }
  if (receipt >= P.RECYCLE_PRESSURE) return { ...timeout(w, rid, "recycled under pressure"), receipt };
  const far = () => Math.hypot(GOAL_X - recv.x, 34 - recv.y) > P.SHOOT_RANGE_M;
  while (far() && w.t < HORIZON_S - P.SHOT_WINDUP_S - 1e-9) {
    [recv.x, recv.y] = stepToward(recv.x, recv.y, 94, 34, P.CARRY_SPEED, P.DT);
    w.ball = [recv.x + 0.6, recv.y];
    w.press(recv.x, recv.y, 0, pressers); w.drift(skip); w.tick();
  }
  if (far()) return { ...timeout(w, rid, "no shot inside the window"), receipt };
  const [q, , tShot] = shoot(w, rid, pressers);
  return { end_reason: "shot" as const, elapsed_s: tShot, q: r(q, 4), receipt };
}

function playIntercept(w: World, a: SAction, rx: number, ry: number, blocker: string, ix: number, iy: number) {
  const P = w.P, rid = a.receiver_id!, recv = w.by[rid], bp = w.by[blocker];
  w.events.push({ t: 0, type: "pass", from: a.actor_id, to: rid, target: [rx, ry] });
  let reached = false, hold = 0;
  const skip = new Set([rid, blocker]);
  while (w.t < 4.0) {
    if (!reached) {
      w.ball = stepToward(w.ball[0], w.ball[1], rx, ry, P.BALL_SPEED, P.DT);
      if (w.t >= P.DEF_REACTION_S) [bp.x, bp.y] = stepToward(bp.x, bp.y, ix, iy, P.DEF_SPEED * 1.2, P.DT);
      if (Math.hypot(w.ball[0] - bp.x, w.ball[1] - bp.y) < 1.2 || Math.hypot(w.ball[0] - rx, w.ball[1] - ry) < 0.5) {
        reached = true; w.ball = [bp.x, bp.y]; w.events.push({ t: r(w.t, 2), type: "interception", player_id: blocker }); hold = w.t + 0.8;
      }
    } else {
      [bp.x, bp.y] = stepToward(bp.x, bp.y, bp.x - 6, bp.y, 5, P.DT);
      w.ball = [bp.x - 0.6, bp.y];
      if (w.t >= hold) break;
    }
    [recv.x, recv.y] = stepToward(recv.x, recv.y, rx, ry, P.RUN_SPEED, P.DT);
    w.drift(skip); w.tick();
  }
}

export function simulateAction(snap: Snapshot, a: SAction, P: Params = DEFAULT_PARAMS): BranchResult {
  let w = new World(snap, P);
  w.record();
  const actor = w.by[a.actor_id];
  const leaves: Leaf[] = [];
  let inputs: BranchResult["inputs"]; let rep = ""; let pComplete: number | null = null;
  if (a.type === "shot") {
    const pressers = new Set(nearestAway(w, actor.x, actor.y, 2));
    const [q, pressure, tShot] = shoot(w, actor.id, pressers);
    leaves.push({ leaf_id: "shot", end_reason: "shot", probability: 1, elapsed_s: tShot, shot_quality: r(q, 4), initial_pass_completed: null, possession_lost: false });
    inputs = { shot_pressure: r(pressure, 4), shot_distance_m: r(Math.hypot(GOAL_X - actor.x, 34 - actor.y), 2) };
    rep = "shot";
  } else {
    const [rx, ry] = a.target; const [sx, sy] = w.ball;
    const dist = Math.hypot(rx - sx, ry - sy);
    const outfield = w.ps.filter((p) => p.team === "away" && p.role !== "GK");
    const lane = laneBlock(sx, sy, rx, ry, outfield.map((p) => [p.x, p.y]));
    const flight = dist / P.BALL_SPEED;
    const probe = new World(snap, P);
    const steps = pyRoundInt(flight / P.DT);
    for (let i = 0; i < steps; i++) { probe.t += P.DT; probe.press(rx, ry, P.DEF_REACTION_S, new Set(nearestAway(probe, rx, ry, 2))); }
    const recvP = pressureAt(rx, ry, probe.opponents());
    pComplete = passCompletion(dist, lane, recvP);
    const blockers = outfield.map((p) => { const [cx, cy] = closestOnSeg(p.x, p.y, sx, sy, rx, ry); return [Math.hypot(cx - p.x, cy - p.y), p.id] as [number, string]; }).sort(pyCmp);
    const blocker = blockers[0]?.[1] ?? null;
    inputs = { pass_distance_m: r(dist, 2), lane_block: r(lane, 4), receiver_pressure_on_arrival: r(recvP, 4), blocking_defender_id: blocker, blocking_defender_distance_m: blockers[0] ? r(blockers[0][0], 2) : null };
    const completed = pComplete >= 0.5;
    let ix = rx, iy = ry, it = 1;
    if (blocker) { const bp = w.by[blocker]; [ix, iy, it] = closestOnSeg(bp.x, bp.y, sx, sy, rx, ry); }
    leaves.push({ leaf_id: "intercepted", end_reason: "turnover", probability: r(1 - pComplete, 6), elapsed_s: r(P.DEF_REACTION_S + Math.max(it * flight, 0.3), 2), shot_quality: null, initial_pass_completed: false, possession_lost: true });
    const cw = completed ? w : new World(snap, P);
    if (!completed) cw.record();
    const f = playPass(cw, a, flight, rx, ry);
    if (completed) rep = "completed_" + f.end_reason;
    const pShot = f.end_reason === "shot" ? 1 : 0;
    leaves.push({ leaf_id: "completed_" + f.end_reason, end_reason: f.end_reason, probability: pShot ? r(pComplete * pShot, 6) : r(pComplete, 6), elapsed_s: f.elapsed_s, shot_quality: f.q, initial_pass_completed: true, possession_lost: false });
    Object.assign(inputs, { receipt_pressure: r(f.receipt, 4), p_shot_given_complete: pShot, q_shot_given_complete_and_shot: f.q });
    if (!completed) {
      w = new World(snap, P); w.record();
      if (blocker) playIntercept(w, a, rx, ry, blocker, ix, iy);
      rep = "intercepted";
    }
  }
  const total = leaves.reduce((s, l) => s + l.probability, 0);
  leaves[leaves.length - 1].probability = r(leaves[leaves.length - 1].probability + (1 - total), 6);
  const shots = leaves.filter((l) => l.end_reason === "shot");
  const V = shots.reduce((s, l) => s + l.probability * (l.shot_quality ?? 0), 0);
  const pS = shots.reduce((s, l) => s + l.probability, 0);
  const pLose = leaves.filter((l) => l.possession_lost).reduce((s, l) => s + l.probability, 0);
  return {
    action_id: a.action_id, inputs, leaves, leaf: rep, frames: w.frames, events: w.events,
    metrics: { p_complete: pComplete == null ? null : r(pComplete, 4), p_lose_possession: r(pLose, 4), q_shot: pS > 0 ? r(V / pS, 4) : null, opportunity_value: r(V, 4) },
  };
}

// ---------- snapshot handling ----------
export function applyIntervention(snap: Snapshot, subjectId: string, after: XY): Snapshot {
  return { ...snap, players: snap.players.map((p) => (p.id === subjectId ? { ...p, x: after[0], y: after[1], vx: 0, vy: 0 } : { ...p })) };
}

export interface Legality { ok: boolean; reasons: string[] }
export function checkSnapshot(snap: Snapshot): Legality {
  const reasons: string[] = [];
  const c = snap.players.find((p) => p.id === snap.carrier_id);
  if (!c) reasons.push("no ball carrier");
  else if (c.team !== "home") reasons.push("ball carrier must be on the attacking team");
  for (const p of snap.players) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) reasons.push(`${p.id} has no coordinates`);
    else if (p.x < 0 || p.x > L || p.y < 0 || p.y > W) reasons.push(`${p.id} is off the pitch`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** Second-last defender line at t0 (scenario constraint used instead of a full offside engine). */
export function offsideLine(snap: Snapshot): number {
  const xs = snap.players.filter((p) => p.team === "away").map((p) => p.x).sort((a, b) => b - a);
  return xs.length >= 2 ? xs[1] : L;
}

/** Auto-generate candidates: a ground pass to every onside team-mate, plus a shot. */
export function candidateActions(snap: Snapshot, overrides: SAction[] = []): { actions: SAction[]; unavailable: Array<{ id: string; reason: string }> } {
  const c = snap.players.find((p) => p.id === snap.carrier_id)!;
  const line = offsideLine(snap);
  const actions: SAction[] = [];
  const unavailable: Array<{ id: string; reason: string }> = [];
  for (const p of snap.players) {
    if (p.team !== "home" || p.id === c.id || p.role === "GK") continue;
    if (p.x > line + 0.01) { unavailable.push({ id: p.id, reason: `${p.name.split(" ").pop()} starts offside` }); continue; }
    const o = overrides.find((a) => a.type === "pass" && a.receiver_id === p.id);
    const tx = clamp(p.x + p.vx * 1.2, 0.5, L - 0.5), ty = clamp(p.y + p.vy * 1.2, 0.5, W - 0.5);
    actions.push(o ? { ...o, actor_id: c.id } : { action_id: `pass_${p.id}`, type: "pass", actor_id: c.id, receiver_id: p.id, target: [r(tx, 2), r(ty, 2)], label: `Pass to ${p.name.split(" ").pop()}` });
  }
  const so = overrides.find((a) => a.type === "shot");
  actions.push(so ? { ...so, actor_id: c.id } : { action_id: "shoot", type: "shot", actor_id: c.id, receiver_id: null, target: [105, 34], label: "Shoot" });
  return { actions, unavailable };
}
