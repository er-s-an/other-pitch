"""QA sends a bad draft back, then the overlay schema passes."""

import copy

from otherpitch.framework import FRAMEWORK
from otherpitch.qa import review_claims
from otherpitch.timeline import validate_timeline
from otherpitch.workflow import run_pipeline


def _run():
    return run_pipeline(7, use_llm=False)


def test_framework_name_is_known():
    assert FRAMEWORK in {"agent_framework", "shim"}


def test_trace_rejects_once_then_passes():
    state = _run()
    intents = [item["intent"] for item in state.trace]
    assert intents.index("qa_reject") < intents.index("qa_pass")
    assert state.rejections == 1
    assert state.qa_passed is True
    reject = next(item for item in state.trace if item["intent"] == "qa_reject")
    assert reject["sender"] == "qa"
    assert reject["receiver"] == "analyst"
    assert reject["payload"]["accepted"] is False
    assert any("decimal" in reason for reason in reject["payload"]["reasons"])
    for key in ("sender", "receiver", "intent", "payload", "evidence_ids"):
        assert key in reject
    draft = next(
        item
        for item in state.trace
        if item["intent"] == "moment_submitted" and item["payload"]["text_source"] == "draft_decoy"
    )
    decoy = draft["payload"]["captions"]["casual"].split()[-1].rstrip(".")
    final = state.timeline["copy"]["casual"]["caption"]
    assert decoy not in final
    assert review_claims(state.moment, state.evidence) == []


def test_pipeline_is_deterministic():
    first = _run()
    second = _run()
    assert first.timeline == second.timeline
    assert first.trace == second.trace


def test_overlay_schema_and_sources():
    state = _run()
    assert validate_timeline(state.timeline) == []
    kinds = {ghost["kind"] for ghost in state.timeline["ghosts"]}
    assert kinds == {"pass", "shot"}
    for ghost in state.timeline["ghosts"]:
        assert ghost["source"] == "synthetic_tracking"
        assert ghost["label"]["source"] == "model_estimate"
    assert set(state.modes) == {"casual", "analyst", "zh"}
    assert "传" in state.modes["zh"]["quiz"]["prompt"] or "猜" in state.modes["zh"]["quiz"]["prompt"]


def test_schema_rejects_a_bad_source():
    state = _run()
    broken = copy.deepcopy(state.timeline)
    broken["frames"][0]["source"] = "broadcast_feed"
    assert validate_timeline(broken)


def test_llm_numbers_are_rejected_and_the_template_airs(monkeypatch):
    monkeypatch.setattr(
        "otherpitch.agents.complete",
        lambda system, user, timeout=12.0: '{"casual": "A stray 61.61 chance.", "analyst": "Still 61.61.", "zh": "数字 61.61。"}',
    )
    state = run_pipeline(7, use_llm=True)
    assert state.rejections >= 2
    assert state.qa_passed is True
    assert "61.61" not in state.timeline["copy"]["casual"]["caption"]
    assert "61.61" not in state.timeline["copy"]["analyst"]["caption"]
    sources = [
        item["payload"].get("text_source")
        for item in state.trace
        if item["intent"] == "moment_submitted"
    ]
    assert "draft_decoy" in sources
    assert "template_forced" in sources
