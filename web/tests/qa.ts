import fs from "node:fs";
import { evaluate, explain, validate } from "../src/engine/explain";
const data = JSON.parse(fs.readFileSync(new URL("../src/data/scenarios.json", import.meta.url), "utf8"));
let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.log("FAIL", m); } };
for (const [id, s] of Object.entries<any>(data.scenes)) {
  const ev = evaluate(s, undefined, s.actions);
  for (const a of ev.actions) { const ex = explain(s, ev, a.action_id); ok(ex.qa.length === 0, `${id}/${a.action_id} ${ex.qa}`); }
  const ex = explain(s, ev, ev.ranking[0]);
  const bad = structuredClone(ex); bad.claims[0].action_id = ev.ranking[1]; ok(validate(bad, ev).length > 0, "wrong subject caught");
  const bad2 = structuredClone(ex); bad2.claims[0].display_value = "39%"; ok(validate(bad2, ev).length > 0, "score as % caught");
  const bad3 = structuredClone(ex); bad3.sentence += " He is 12 m out."; ok(validate(bad3, ev).length > 0, "unbound number caught");
  const bad4 = structuredClone(ex); bad4.claims[0].evidence_id = "ev:none"; ok(validate(bad4, ev).length > 0, "missing evidence caught");
  const t = performance.now(); for (let i = 0; i < 50; i++) evaluate(s); const ms = (performance.now() - t) / 50;
  console.log(`${id}: ${ev.actions.length} candidates, focus ${ev.focus}, evaluate() ${ms.toFixed(2)} ms avg`);
}
console.log(fails ? `${fails} failures` : "QA tests passed");
process.exit(fails ? 1 : 0);
