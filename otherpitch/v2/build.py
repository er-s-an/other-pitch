"""Producer CLI: run the real workflow for every scene/variant and export immutable bundles.

    .venv/bin/python -m otherpitch.v2.build --out web/public/data/v2 [--fault-injection]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from mcp import ClientSession
from mcp.client.stdio import stdio_client

from otherpitch.v2 import DEFINITION_VERSION, ENGINE_VERSION, HORIZON_S, POLICY_VERSION, SCHEMA_VERSION
from otherpitch.v2.evidence import METRICS
from otherpitch.v2.scenarios import HELDOUT, HOME, AWAY, PLAYABLE, get_scenario, variants
from otherpitch.v2.simulation import leadin_frames, make_snapshot
from otherpitch.v2.workflow import run_scene, server_params, trace_document

_SECRET = re.compile(r"(api[-_]?key|authorization|bearer)\s*[:=]\s*\S+", re.I)


def _write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False))


def _sanitize(obj):
    raw = json.dumps(obj)
    raw = _SECRET.sub(r"\1: [redacted]", raw).replace(str(Path.home()), "~")
    return json.loads(raw)


def bundle_from(run, generated_at: str) -> dict:
    scn = get_scenario(run.scene)
    snap = make_snapshot(scn, run.variant)
    branches = []
    for a in scn["actions"]:
        b = run.branches[a["action_id"]]
        branches.append({
            "action_id": a["action_id"], "label": a["label"], "type": a["type"], "actor_id": a["actor_id"],
            "receiver_id": a["receiver_id"], "target": a["target"],
            "metrics": b["metrics"], "inputs": b["inputs"], "outcome_tree": b["outcome_tree"],
            "trajectory_kind": "representative_simulation", "representative_leaf": b["trajectory"]["leaf"],
            "events": b["trajectory"]["events"], "frames_ref": f"motion/{a['action_id']}.json",
            "metric_evidence_ids": sorted(k for k in run.evidence if k.split(":")[3] == a["action_id"]),
        })
    return {
        "schema_version": SCHEMA_VERSION,
        "bundle_id": f"{run.scene}:{run.variant}:{ENGINE_VERSION}",
        "scene_id": run.scene, "scenario_version": scn["scenario_version"], "variant_id": run.variant,
        "title": scn["title"], "brief": scn["brief"], "tactic": scn["tactic"],
        "clock": scn["clock"], "score": scn["score"], "teams": {"home": HOME, "away": AWAY},
        "horizon_s": HORIZON_S, "objective": "expected_first_shot_quality", "provenance": "synthetic",
        "t0": snap["t0"], "base_state_hash": snap["base_state_hash"], "state_hash": snap["state_hash"],
        "carrier_id": snap["carrier_id"], "key_defender_ids": snap["key_defender_ids"],
        "players": [{k: p[k] for k in ("id", "team", "number", "name", "role", "x", "y")} for p in snap["players"]],
        "intervention": snap["intervention"],
        "available_interventions": [{k: i[k] for k in ("intervention_id", "variant_id", "label", "subject_id")} for i in scn["interventions"]],
        "recorded_action_id": scn["recorded_action_id"],
        "recorded_action_note": "Synthetic record of what the fictional player did. Not a correct answer.",
        "leadin": {"dt": 0.1, "frames": leadin_frames(snap)},
        "branches": branches,
        "focus": run.focus, "focus_trigger": run.focus_trigger,
        "explanations": run.explanations,
        "evidence": run.evidence,
        "metric_definitions": {k: {"label": v["label"], "unit": v["unit"], "definition": v["definition"]} for k, v in METRICS.items()},
        "generation": {"mode": "precomputed", "cache_status": "cached_validated_result", "run_id": run.run_id,
                       "engine_version": ENGINE_VERSION, "policy_version": POLICY_VERSION,
                       "definition_version": DEFINITION_VERSION, "generated_at": generated_at,
                       "trace_ref": "trace.json"},
        "validation": {"status": "passed" if run.qa_status.startswith("validated") else "failed",
                       "qa_status": run.qa_status, "revisions": run.revisions, "report_ref": "validation.json"},
    }


async def build_all(out: Path, fault_injection: bool) -> dict:
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    catalog = {"schema_version": SCHEMA_VERSION, "engine_version": ENGINE_VERSION, "generated_at": generated_at, "scenes": []}
    summary = []
    async with stdio_client(server_params()) as (rd, wr):
        async with ClientSession(rd, wr) as s:
            await s.initialize()
            for scene in PLAYABLE + HELDOUT:
                scn = get_scenario(scene)
                entry = {"scene_id": scene, "title": scn["title"], "brief": scn["brief"], "clock": scn["clock"],
                         "scenario_version": scn["scenario_version"], "variants": [], "heldout": scene in HELDOUT}
                for variant in variants(scene):
                    run = await run_scene(scene, variant, session=s)
                    d = out / scene / variant
                    tr = _sanitize(trace_document(run))
                    _write(d / "trace.json", tr)
                    if run.result != "published":
                        entry["variants"].append({"variant_id": variant, "status": "rejected"})
                        summary.append((scene, variant, run.result, run.qa_status))
                        continue
                    bundle = bundle_from(run, generated_at)
                    _write(d / "bundle.json", bundle)
                    for aid, b in run.branches.items():
                        _write(d / "motion" / f"{aid}.json", {"action_id": aid, "variant_id": variant, "dt": b["trajectory"]["dt"],
                                                             "kind": "representative_simulation", "leaf": b["trajectory"]["leaf"],
                                                             "frames": b["trajectory"]["frames"]})
                    _write(d / "validation.json", {"bundle_id": bundle["bundle_id"], "qa_status": run.qa_status,
                                                   "claims_checked": sum(len(x["claims"]) for x in run.explanations.values()),
                                                   "tree_sums": {b["action_id"]: round(sum(l["probability"] for l in b["outcome_tree"]["leaves"]), 9) for b in bundle["branches"]},
                                                   "run_id": run.run_id})
                    entry["variants"].append({"variant_id": variant, "status": "published", "run_id": run.run_id,
                                              "label": "Base" if variant == "base" else next(i["label"] for i in scn["interventions"] if i["variant_id"] == variant)})
                    summary.append((scene, variant, run.result, run.qa_status))
                catalog["scenes"].append(entry)
            if fault_injection:
                run = await run_scene("central-lane", "base", fault_injection=True, session=s)
                doc = _sanitize(trace_document(run))
                doc["label"] = "DIAGNOSTIC: fault injection test. One wrong-subject claim was injected on purpose."
                _write(out / "diagnostics" / "fault-injection-trace.json", doc)
                summary.append(("diagnostic", "fault-injection", run.result, run.qa_status))
    _write(out / "scenes.json", catalog)
    return {"summary": summary}


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("web/public/data/v2"))
    ap.add_argument("--fault-injection", action="store_true")
    args = ap.parse_args(argv)
    res = asyncio.run(build_all(args.out, args.fault_injection))
    for row in res["summary"]:
        print(*row)


if __name__ == "__main__":
    main()
