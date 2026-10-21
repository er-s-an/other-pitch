"""Optional TypeSafe Jev (System One, Choice) evaluator: interface stub, disabled by default.

Not integrated: it needs paid credit that is not set up. The contract below is the
project-internal wrapper (docs/PLAN-v2.md section 9.4), not a vendor request body.
Enable later with OTHERPITCH_JEV=1 plus JEV_API_KEY and JEV_MODEL_ID, after implementing _call.
The pipeline must play identically with this module switched off.
"""

from __future__ import annotations

import os


class EvaluatorUnavailable(RuntimeError):
    pass


def enabled() -> bool:
    return os.environ.get("OTHERPITCH_JEV", "0") == "1" and bool(os.environ.get("JEV_API_KEY"))


def build_request(scenario_id: str, evidence_hash: str, evidence: dict, allowed_labels: list[str]) -> dict:
    return {"task": "select_explanation_focus", "task_version": "focus-v1",
            "model_id": os.environ.get("JEV_MODEL_ID", "<pin-a-tested-official-model-id>"),
            "scenario_id": scenario_id, "evidence_hash": evidence_hash,
            "allowed_labels": list(allowed_labels), "evidence": evidence}


def _call(request: dict) -> dict:  # pragma: no cover - not integrated yet
    raise NotImplementedError("Jev is not integrated yet")


def select_focus(scenario_id: str, evidence_hash: str, evidence: dict, allowed_labels: list[str]) -> tuple[str | None, str]:
    """Return (label or None, trace status). Never raises; never edits facts."""
    if not enabled():
        return None, "optional_evaluator_disabled"
    try:
        result = _call(build_request(scenario_id, evidence_hash, evidence, allowed_labels))
    except Exception:
        return None, "optional_evaluator_unavailable"
    label = result.get("label")
    if label not in allowed_labels:
        return None, "optional_evaluator_invalid_label"
    return label, "optional_evaluator_used"
