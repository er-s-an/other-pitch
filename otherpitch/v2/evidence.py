"""Typed evidence, claims and explanation rendering.

Every number a fan reads is a Claim bound to one MetricEvidence record: whose value
(scenario, variant, action), which metric, which unit, which window, which version.
Text is rendered from claims by code; free text may not introduce numbers.
"""

from __future__ import annotations

from otherpitch.v2 import DEFINITION_VERSION, HORIZON_S

METRICS = {
    "p_complete": {"label": "Estimated pass completion", "unit": "fraction", "format": "percent",
                   "source_kind": "derived_metric",
                   "definition": "Internal estimate that the initial pass is controlled by the intended team-mate, from distance, lane block and receiver pressure. Null for shots."},
    "p_lose_possession": {"label": "Estimated possession risk", "unit": "fraction", "format": "percent",
                          "source_kind": "simulated_branch",
                          "definition": "Sum of outcome-tree leaves where possession is lost before the 8 s window ends or the first shot."},
    "q_shot": {"label": "Simulated shot quality", "unit": "normalized_score", "format": "score100",
               "source_kind": "derived_metric",
               "definition": "Synthetic 0-1 shot-quality score at the moment of the first shot, given a shot happens. Not calibrated on real matches."},
    "opportunity_value": {"label": "Opportunity quality", "unit": "normalized_score", "format": "score100",
                          "source_kind": "simulated_branch",
                          "definition": "V = sum over outcome-tree leaves of probability x shot quality for the first legal shot inside 8 s. Paths without a shot count 0. Not a goal probability."},
    "lane_block": {"label": "Lane block", "unit": "index_0_1", "format": "score100",
                   "source_kind": "derived_metric",
                   "definition": "1 when an outfield opponent stands on the pass line, 0 when the line is clear by 6 m, at t0."},
}

FOCUS_LABELS = ["lane_blocked", "receiver_space", "shot_quality", "close_tradeoff", "insufficient_evidence"]


def display(metric_name: str, value: float | None) -> str | None:
    if value is None:
        return None
    fmt = METRICS[metric_name]["format"]
    if fmt == "percent":
        return f"{round(value * 100):d}%"
    return f"{round(value * 100):d} / 100"


def evidence_id(scene: str, variant: str, action: str, metric: str) -> str:
    return f"ev:{scene}:{variant}:{action}:{metric}"


def branch_evidence(snap: dict, branch: dict) -> dict[str, dict]:
    out = {}
    scene, variant, action = snap["scenario_id"], snap["variant_id"], branch["action_id"]
    values = dict(branch["metrics"])
    if "lane_block" in branch["inputs"]:
        values["lane_block"] = branch["inputs"]["lane_block"]
    for m, v in values.items():
        if v is None:
            continue
        eid = evidence_id(scene, variant, action, m)
        out[eid] = {
            "evidence_id": eid, "metric_name": m, "value": v, "unit": METRICS[m]["unit"],
            "display_value": display(m, v), "label": METRICS[m]["label"],
            "subject": {"scenario_id": scene, "variant_id": variant, "action_id": action},
            "definition": METRICS[m]["definition"], "definition_version": DEFINITION_VERSION,
            "time_window_s": HORIZON_S, "source_kind": METRICS[m]["source_kind"],
            "source_ids": [snap["state_hash"]],
        }
    return out


def make_claim(cid: str, ev: dict) -> dict:
    return {
        "claim_id": cid, "subject": dict(ev["subject"]), "metric_id": ev["evidence_id"],
        "metric_name": ev["metric_name"], "raw_value": ev["value"], "unit": ev["unit"],
        "display_value": ev["display_value"], "label": ev["label"], "evidence_id": ev["evidence_id"],
        "definition_version": ev["definition_version"], "time_window_s": ev["time_window_s"],
    }


def _name(snap, pid):
    p = next((p for p in snap["players"] if p["id"] == pid), None)
    return p["name"].split()[-1] if p else pid


def select_focus(snap: dict, branches: dict[str, dict], base_branches: dict[str, dict] | None) -> tuple[str, dict]:
    """Rule-based explanation focus. Returns (label, the evidence that triggered it)."""
    if not branches:
        return "insufficient_evidence", {}
    ranked = sorted(branches.values(), key=lambda b: -b["metrics"]["opportunity_value"])
    top = ranked[0]
    if snap.get("intervention") and base_branches:
        deltas = {a: base_branches[a]["metrics"]["p_complete"] - b["metrics"]["p_complete"]
                  for a, b in branches.items() if b["metrics"]["p_complete"] is not None and a in base_branches}
        if deltas:
            a, d = max(deltas.items(), key=lambda kv: kv[1])
            if d > 0.1:
                return "lane_blocked", {"action_id": a, "p_complete_drop": round(d, 4)}
    if len(ranked) > 1:
        second = ranked[1]
        v1, v2 = top["metrics"]["opportunity_value"], second["metrics"]["opportunity_value"]
        if v1 > 0 and v2 / v1 >= 0.75:
            return "close_tradeoff", {"actions": [top["action_id"], second["action_id"]]}
    if top["metrics"]["p_complete"] is None:
        return "shot_quality", {"action_id": top["action_id"]}
    if top["inputs"].get("lane_block", 1) < 0.3:
        return "receiver_space", {"action_id": top["action_id"]}
    return "lane_blocked", {"action_id": top["action_id"]}


def _pressure_word(v):
    return "little" if v < 0.3 else ("some" if v < 0.6 else "heavy")


def explain_action(snap: dict, action: dict, branch: dict, others: list[dict], focus: str,
                   ev_book: dict, hints: dict | None, trigger: dict | None = None) -> dict:
    """ExplanationSpec for one chosen action, casual and analyst. Claims carry every number."""
    scene, variant = snap["scenario_id"], snap["variant_id"]
    aid = action["action_id"]
    claims = []

    def c(action_id, metric):
        eid = evidence_id(scene, variant, action_id, metric)
        if eid not in ev_book:
            return None
        cl = make_claim(f"claim:{scene}:{variant}:{action_id}:{metric}", ev_book[eid])
        if cl["claim_id"] not in {x["claim_id"] for x in claims}:
            claims.append(cl)
        return cl

    V = branch["metrics"]["opportunity_value"]
    best_other = max(others, key=lambda b: b["metrics"]["opportunity_value"]) if others else None
    Vo = best_other["metrics"]["opportunity_value"] if best_other else 0
    if V >= Vo and (V == 0 or Vo / max(V, 1e-9) < 0.75):
        verdict = "strongest"
        headline = "That was the strongest route in this model."
    elif max(V, Vo) > 0 and min(V, Vo) / max(V, Vo) >= 0.75:
        verdict = "close"
        headline = "Close call: two routes are near each other."
    else:
        verdict = "weaker"
        headline = "Another route created a better chance."
    inp = branch["inputs"]
    leaf = branch["trajectory"]["leaf"]
    if action["type"] == "shot":
        why = (f"{_name(snap, action['actor_id'])} shoots from "
               + ("long range" if inp.get("shot_distance_m", 30) > 22 else "the edge of the box")
               + f" with {_pressure_word(inp.get('shot_pressure', 0))} pressure, so the shot itself carries the value.")
    elif leaf == "intercepted" or branch["metrics"]["p_lose_possession"] >= 0.5:
        why = (f"{_name(snap, inp['blocking_defender_id'])} is close to the line of the pass, "
               f"so the ball is likely to be cut out before {_name(snap, action['receiver_id'])} gets it.")
    elif inp.get("p_shot_given_complete") == 0:
        why = f"{_name(snap, action['receiver_id'])} receives under pressure and, under the fixed follow-up rule, cannot shoot inside the window."
    else:
        why = (f"{_name(snap, action['receiver_id'])} receives with {_pressure_word(inp.get('receipt_pressure', 0))} pressure "
               "and has time to shoot inside the window.")
    trigger = trigger or {}
    focus_on_me = trigger.get("action_id") == aid or aid in trigger.get("actions", [])
    why_hint = hints[focus] if (hints and focus in hints and focus_on_me) else None
    if verdict == "strongest" and branch["metrics"]["p_lose_possession"] >= 0.5:
        headline = "Still the best chance here, but a risky one."
    cv = c(aid, "opportunity_value")
    casual_metrics = [cv["claim_id"]]
    if action["type"] == "pass":
        casual_metrics.append(c(aid, "p_complete")["claim_id"])
    analyst_lines = []
    for b in [branch] + [o for o in others]:
        a2 = b["action_id"]
        ids = [x["claim_id"] for x in (c(a2, m) for m in ("opportunity_value", "p_complete", "p_lose_possession", "q_shot", "lane_block")) if x]
        analyst_lines.append({"action_id": a2, "claim_ids": ids})
    compare = None
    if best_other:
        co = c(best_other["action_id"], "opportunity_value")
        compare = {"action_id": best_other["action_id"], "claim_id": co["claim_id"]}
    return {
        "action_id": aid, "variant_id": variant, "verdict": verdict, "focus": focus,
        "casual": {"headline": headline, "sentence": why_hint or why, "template_sentence": why,
                   "metric_claim_ids": casual_metrics, "uncertainty": "One simulated possibility."},
        "analyst": {"headline": headline, "sentence": why, "lines": analyst_lines, "compare": compare,
                    "assumptions": [
                        "Synthetic scenario; positions are invented.",
                        "8 s window; first legal shot only; no goal is simulated.",
                        "Follow-up rule one-control-one-shot-v1: control, carry to range, shoot.",
                        "Defenders react after 0.4 s at up to 6 m/s; coefficients are heuristic, not fitted.",
                    ]},
        "claims": claims,
        "llm_status": "not_requested",
    }
