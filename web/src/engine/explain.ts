// Deterministic, evidence-driven explanations with client-side claim QA.
// Every number shown in the sandbox is a Claim bound to one computed evidence record.
import { simulateAction, candidateActions, checkSnapshot, type BranchResult, type Params, type SAction, type Snapshot, DEFAULT_PARAMS, HORIZON_S } from "./engine";

export type MetricName = "p_complete" | "p_lose_possession" | "q_shot" | "opportunity_value" | "lane_block";
export const METRIC: Record<MetricName, { label: string; unit: "fraction" | "normalized_score" | "index_0_1"; fmt: "pct" | "score" }> = {
  p_complete: { label: "Estimated pass completion", unit: "fraction", fmt: "pct" },
  p_lose_possession: { label: "Estimated possession risk", unit: "fraction", fmt: "pct" },
  q_shot: { label: "Simulated shot quality", unit: "normalized_score", fmt: "score" },
  opportunity_value: { label: "Opportunity quality", unit: "normalized_score", fmt: "score" },
  lane_block: { label: "Lane block", unit: "index_0_1", fmt: "score" },
};
export function display(m: MetricName, v: number) { return METRIC[m].fmt === "pct" ? `${Math.round(v * 100)}%` : `${Math.round(v * 100)} / 100`; }

export interface Evidence { evidence_id: string; metric: MetricName; value: number; unit: string; action_id: string; state_hash: string; window_s: number }
export interface Claim { claim_id: string; evidence_id: string; action_id: string; metric: MetricName; raw_value: number; unit: string; display_value: string; label: string }
export interface Explanation { action_id: string; verdict: "strongest" | "close" | "weaker"; headline: string; sentence: string; claims: Claim[]; qa: string[] }
export interface Evaluation {
  state_hash: string; actions: SAction[]; branches: Record<string, BranchResult>; ranking: string[];
  evidence: Record<string, Evidence>; unavailable: Array<{ id: string; reason: string }>; legality: string[]; ms: number; focus: string;
}

export function stateHash(s: Snapshot, P: Params) {
  const str = JSON.stringify([s.carrier_id, s.players.map((p) => [p.id, p.team, +p.x.toFixed(2), +p.y.toFixed(2), +p.vx.toFixed(2), +p.vy.toFixed(2)]), P]);
  let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return "fnv1a:" + (h >>> 0).toString(16).padStart(8, "0");
}

export function evaluate(snap: Snapshot, P: Params = DEFAULT_PARAMS, overrides: SAction[] = []): Evaluation {
  const t0 = performance.now();
  const leg = checkSnapshot(snap);
  const hash = stateHash(snap, P);
  if (!leg.ok) return { state_hash: hash, actions: [], branches: {}, ranking: [], evidence: {}, unavailable: [], legality: leg.reasons, ms: performance.now() - t0, focus: "insufficient_evidence" };
  const { actions, unavailable } = candidateActions(snap, overrides);
  const branches: Record<string, BranchResult> = {};
  const evidence: Record<string, Evidence> = {};
  for (const a of actions) {
    const b = simulateAction(snap, a, P);
    branches[a.action_id] = b;
    const vals: Partial<Record<MetricName, number | null>> = { ...b.metrics };
    if (typeof b.inputs.lane_block === "number") vals.lane_block = b.inputs.lane_block;
    for (const [m, v] of Object.entries(vals) as Array<[MetricName, number | null]>) {
      if (v == null) continue;
      const id = `ev:${hash}:${a.action_id}:${m}`;
      evidence[id] = { evidence_id: id, metric: m, value: v, unit: METRIC[m].unit, action_id: a.action_id, state_hash: hash, window_s: HORIZON_S };
    }
  }
  const ranking = [...actions].map((a) => a.action_id).sort((x, y) => branches[y].metrics.opportunity_value - branches[x].metrics.opportunity_value || (x < y ? -1 : 1));
  const top = branches[ranking[0]], second = branches[ranking[1]];
  let focus = "receiver_space";
  if (!top) focus = "insufficient_evidence";
  else if (second && top.metrics.opportunity_value > 0 && second.metrics.opportunity_value / top.metrics.opportunity_value >= 0.75) focus = "close_tradeoff";
  else if (top.metrics.p_complete == null) focus = "shot_quality";
  else if (Number(top.inputs.lane_block) >= 0.3) focus = "lane_blocked";
  return { state_hash: hash, actions, branches, ranking, evidence, unavailable, legality: [], ms: performance.now() - t0, focus };
}

const surname = (snap: Snapshot, id: string | null | undefined) => snap.players.find((p) => p.id === id)?.name.split(" ").pop() ?? "";
const pw = (v: number) => (v < 0.3 ? "little" : v < 0.6 ? "some" : "heavy");

export function explain(snap: Snapshot, ev: Evaluation, actionId: string): Explanation {
  const a = ev.actions.find((x) => x.action_id === actionId)!;
  const b = ev.branches[actionId];
  const claims: Claim[] = [];
  const c = (aid: string, m: MetricName) => {
    const e = ev.evidence[`ev:${ev.state_hash}:${aid}:${m}`];
    if (!e) return null;
    const cl: Claim = { claim_id: `c:${aid}:${m}`, evidence_id: e.evidence_id, action_id: aid, metric: m, raw_value: e.value, unit: e.unit, display_value: display(m, e.value), label: METRIC[m].label };
    claims.push(cl); return cl;
  };
  const V = b.metrics.opportunity_value;
  const bestOther = ev.ranking.filter((x) => x !== actionId).map((x) => ev.branches[x])[0];
  const Vo = bestOther?.metrics.opportunity_value ?? 0;
  let verdict: Explanation["verdict"], headline: string;
  if (V >= Vo && (V === 0 || Vo / Math.max(V, 1e-9) < 0.75)) { verdict = "strongest"; headline = b.metrics.p_lose_possession >= 0.5 ? "Best chance here, but a risky one." : "The strongest route in this state."; }
  else if (Math.max(V, Vo) > 0 && Math.min(V, Vo) / Math.max(V, Vo) >= 0.75) { verdict = "close"; headline = "Close call: two routes are near each other."; }
  else { verdict = "weaker"; headline = "Another route creates a better chance."; }
  const inp = b.inputs;
  let sentence: string;
  if (a.type === "shot") sentence = `${surname(snap, a.actor_id)} shoots from ${Number(inp.shot_distance_m) > 22 ? "long range" : "close range"} with ${pw(Number(inp.shot_pressure))} pressure, so the shot itself carries the value.`;
  else if (b.leaf === "intercepted" || b.metrics.p_lose_possession >= 0.5) sentence = `${surname(snap, inp.blocking_defender_id as string)} is close to the line of the pass, so the ball is likely to be cut out before ${surname(snap, a.receiver_id)} gets it.`;
  else if (inp.p_shot_given_complete === 0) sentence = `${surname(snap, a.receiver_id)} receives but, under the fixed follow-up rule, cannot shoot inside the window.`;
  else sentence = `${surname(snap, a.receiver_id)} receives with ${pw(Number(inp.receipt_pressure))} pressure and has time to shoot inside the window.`;
  c(actionId, "opportunity_value"); if (a.type === "pass") { c(actionId, "p_complete"); c(actionId, "lane_block"); }
  c(actionId, "p_lose_possession"); c(actionId, "q_shot");
  if (bestOther) c(bestOther.action_id, "opportunity_value");
  const ex: Explanation = { action_id: actionId, verdict, headline, sentence, claims, qa: [] };
  ex.qa = validate(ex, ev);
  return ex;
}

const FORBIDDEN = [/goal probability/i, /chance of scoring/i, /will score/i, /\bxg\b/i];
export function validate(ex: Explanation, ev: Evaluation): string[] {
  const errs: string[] = [];
  for (const c of ex.claims) {
    const e = ev.evidence[c.evidence_id];
    if (!e) { errs.push(`${c.claim_id}: no computed value`); continue; }
    if (e.action_id !== c.action_id) errs.push(`${c.claim_id}: value belongs to ${e.action_id}`);
    if (e.metric !== c.metric) errs.push(`${c.claim_id}: metric borrowed from ${e.metric}`);
    if (e.unit !== c.unit) errs.push(`${c.claim_id}: unit mismatch`);
    if (Math.abs(e.value - c.raw_value) > 1e-9) errs.push(`${c.claim_id}: value mismatch`);
    if (c.display_value !== display(c.metric, e.value)) errs.push(`${c.claim_id}: display mismatch`);
    if (e.unit === "normalized_score" && c.display_value.includes("%")) errs.push(`${c.claim_id}: score shown as a percentage`);
    if (e.state_hash !== ev.state_hash) errs.push(`${c.claim_id}: stale state`);
  }
  for (const t of [ex.headline, ex.sentence]) {
    for (const f of FORBIDDEN) if (f.test(t)) errs.push(`text uses forbidden wording ${f}`);
    if (/\d/.test(t)) errs.push(`text introduces an unbound number: "${t}"`);
  }
  return errs;
}
