import copy

import pytest

from otherpitch.v2.evidence import branch_evidence, display, make_claim
from otherpitch.v2.qa import validate_claim, validate_text
from otherpitch.v2.scenarios import get_scenario, scenario_ids, variants
from otherpitch.v2.simulation import InvalidSnapshot, make_snapshot, simulate_all
from otherpitch.v2.workflow import run_sync


def branches(scene, variant="base"):
    return {b["action_id"]: b for b in simulate_all(make_snapshot(get_scenario(scene), variant))}


def test_actions_produce_different_trajectories_from_same_state():
    bs = branches("central-lane")
    hashes = {b["state_hash"] for b in bs.values()}
    assert len(hashes) == 1
    ends = {a: tuple(b["trajectory"]["frames"][-1]["ball"]) for a, b in bs.items()}
    assert len(set(ends.values())) == 3
    assert all(b["trajectory"]["frames"][0]["t"] == 0.0 for b in bs.values())


@pytest.mark.parametrize("scene", scenario_ids())
def test_tree_conserves_probability_and_respects_horizon(scene):
    for v in variants(scene):
        for b in branches(scene, v).values():
            leaves = b["outcome_tree"]["leaves"]
            assert abs(sum(l["probability"] for l in leaves) - 1) < 1e-9
            assert all(0 <= l["elapsed_s"] <= 8.0 for l in leaves)
            V = sum(l["probability"] * l["shot_quality"] for l in leaves if l["end_reason"] == "shot")
            assert abs(V - b["metrics"]["opportunity_value"]) < 1e-3


def test_scenes_are_structurally_different():
    carriers = {get_scenario(s)["carrier_id"] for s in ("central-lane", "open-not-safe", "close-call")}
    assert len(carriers) == 3


def test_intervention_changes_one_declared_thing_and_drives_computation():
    snap = make_snapshot(get_scenario("central-lane"), "lane_closed")
    iv = snap["intervention"]
    assert iv["subject_id"] == "a6" and iv["base_state_hash"] == snap["base_state_hash"] != snap["state_hash"]
    base = make_snapshot(get_scenario("central-lane"))
    diff = [(a["id"]) for a, b in zip(base["players"], snap["players"]) if a != b]
    assert diff == ["a6"]
    b0, b1 = branches("central-lane"), branches("central-lane", "lane_closed")
    assert b1["pass_central"]["metrics"]["p_complete"] < b0["pass_central"]["metrics"]["p_complete"] - 0.2
    assert b1["shoot"]["metrics"] == b0["shoot"]["metrics"]


def test_missing_coordinates_are_rejected():
    scn = get_scenario("heldout-01")
    scn["players"][1]["x"] = None
    with pytest.raises(InvalidSnapshot) as e:
        make_snapshot(scn)
    assert "players[1].x" in e.value.missing_fields


def _ev():
    snap = make_snapshot(get_scenario("central-lane"))
    book = {}
    for b in simulate_all(snap):
        book.update(branch_evidence(snap, b))
    return book


def test_claim_binding_rejects_wrong_subject_metric_unit_and_display():
    book = _ev()
    good = make_claim("c1", book["ev:central-lane:base:pass_central:p_complete"])
    assert validate_claim(good, book) == []
    bad = copy.deepcopy(good); bad["subject"]["action_id"] = "pass_wide"
    assert validate_claim(bad, book)
    bad = copy.deepcopy(good); bad["metric_name"] = "opportunity_value"
    assert validate_claim(bad, book)
    bad = copy.deepcopy(good); bad["unit"] = "normalized_score"
    assert validate_claim(bad, book)
    bad = copy.deepcopy(good); bad["display_value"] = str(round(good["raw_value"] * 100))
    assert validate_claim(bad, book)
    v = make_claim("c2", book["ev:central-lane:base:pass_central:opportunity_value"])
    assert v["display_value"].endswith("/ 100")
    bad = copy.deepcopy(v); bad["display_value"] = display("p_complete", v["raw_value"])
    assert validate_claim(bad, book)
    bad = copy.deepcopy(v); bad["evidence_id"] = "ev:nope"
    assert validate_claim(bad, book)


def test_text_check_catches_unbound_numbers_and_goal_probability():
    assert validate_text("Quinn has a 39% goal probability", ["39 / 100"])
    assert validate_text("He is 12 m out", [])
    assert validate_text("Opportunity quality 39 / 100", ["39 / 100"]) == []


def test_normal_run_passes_first_time_through_real_mcp():
    r = run_sync("central-lane", "lane_closed")
    assert r.result == "published" and r.qa_status == "validated_first_pass"
    tools = [c["tool"] for c in r.tool_calls]
    assert {"get_decision_snapshot", "list_legal_actions", "simulate_branch", "get_evidence"} <= set(tools)
    used = {c["claim_id"].split(":", 1)[1] for s in r.explanations.values() for c in s["claims"]}
    returned = set().union(*[set(c["result"].get("evidence_ids_returned", [])) for c in r.tool_calls])
    assert {"ev:" + u for u in used} <= returned


def test_fault_injection_is_explicit_and_recovers():
    r = run_sync("close-call", fault_injection=True)
    intents = [s["intent"] for s in r.steps]
    assert "fault_injection" in intents and "claim_rejected" in intents
    assert r.qa_status == "validated_after_revision"


def test_heldout_runs_same_pipeline_without_hints():
    assert get_scenario("heldout-01")["explanation_hints"] == {}
    r = run_sync("heldout-01")
    assert r.result == "published"
