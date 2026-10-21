import fs from "node:fs";
import { applyIntervention, simulateAction, type Snapshot } from "../src/engine/engine";

const data = JSON.parse(fs.readFileSync(new URL("../src/data/scenarios.json", import.meta.url), "utf8"));
const fx = JSON.parse(fs.readFileSync(new URL("./parity-fixture.json", import.meta.url), "utf8"));
const TOL = 1e-6;
let fails = 0, checks = 0, maxDiff = 0;
const cmp = (label: string, a: number | null, b: number | null, tol = TOL) => {
  checks++;
  if (a == null || b == null) { if (a !== b) { fails++; console.log("MISMATCH", label, a, b); } return; }
  const d = Math.abs(a - b); maxDiff = Math.max(maxDiff, d);
  if (d > tol) { fails++; console.log("MISMATCH", label, a, b); }
};
for (const f of fx) {
  const scn = data.scenes[f.scene];
  let snap: Snapshot = scn;
  if (f.variant !== "base") { const iv = scn.interventions.find((i: { variant_id: string }) => i.variant_id === f.variant); snap = applyIntervention(scn, iv.subject_id, iv.after); }
  const a = scn.actions.find((x: { action_id: string }) => x.action_id === f.action_id);
  const t0 = performance.now();
  const b = simulateAction(snap, a);
  const ms = performance.now() - t0;
  const k = `${f.scene}/${f.variant}/${f.action_id}`;
  for (const m of ["p_complete", "p_lose_possession", "q_shot", "opportunity_value"]) cmp(`${k} ${m}`, (b.metrics as never)[m], f.metrics[m]);
  f.leaves.forEach((l: { probability: number; shot_quality: number | null; elapsed_s: number }, i: number) => {
    cmp(`${k} leaf${i}.p`, b.leaves[i]?.probability ?? null, l.probability);
    cmp(`${k} leaf${i}.q`, b.leaves[i]?.shot_quality ?? null, l.shot_quality);
    cmp(`${k} leaf${i}.t`, b.leaves[i]?.elapsed_s ?? null, l.elapsed_s);
  });
  checks++; if (b.leaf !== f.leaf) { fails++; console.log("MISMATCH leaf", k, b.leaf, f.leaf); }
  cmp(`${k} frames`, b.frames.length, f.frame_count, 0);
  cmp(`${k} last_ball.x`, b.frames.at(-1)!.ball[0], f.last_ball[0], 0.011);
  cmp(`${k} last_ball.y`, b.frames.at(-1)!.ball[1], f.last_ball[1], 0.011);
  console.log(`${k.padEnd(40)} V=${b.metrics.opportunity_value} py=${f.metrics.opportunity_value} ${ms.toFixed(2)}ms`);
}
console.log(`\n${fx.length} branches, ${checks} checks, ${fails} mismatches, max |diff| ${maxDiff.toExponential(2)}`);
process.exit(fails ? 1 : 0);
