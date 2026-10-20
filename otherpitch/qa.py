"""Check every decimal in a claim against cited evidence."""

from __future__ import annotations

import re
from typing import Any

FLOAT_RE = re.compile(r"\d+\.\d+")
# Two-decimal narration is at most 0.005 away from the stored figure.
TOLERANCE = 0.008


def collect_numbers(value: Any) -> list[float]:
    found: list[float] = []

    def walk(node: Any) -> None:
        if isinstance(node, bool):
            return
        if isinstance(node, (int, float)):
            found.append(float(node))
            return
        if isinstance(node, str):
            for match in FLOAT_RE.findall(node):
                found.append(float(match))
            return
        if isinstance(node, dict):
            for item in node.values():
                walk(item)
            return
        if isinstance(node, (list, tuple)):
            for item in node:
                walk(item)

    walk(value)
    return found


def stray_decimals(text: str, allowed: list[float], tolerance: float = TOLERANCE) -> list[str]:
    bad: list[str] = []
    for match in FLOAT_RE.findall(text):
        value = float(match)
        if not any(abs(value - number) <= tolerance for number in allowed):
            bad.append(match)
    return bad


def _strings(node: Any) -> list[str]:
    out: list[str] = []
    if isinstance(node, str):
        out.append(node)
    elif isinstance(node, dict):
        for key, value in node.items():
            if str(key).startswith("_"):
                continue
            out.extend(_strings(value))
    elif isinstance(node, list):
        for value in node:
            out.extend(_strings(value))
    return out


def review_claims(moment: dict, evidence: dict[str, Any]) -> list[str]:
    """Return human-readable reasons. An empty list means the claim may air."""
    reasons: list[str] = []
    cited = list(moment.get("evidence_ids") or [])
    if not cited:
        reasons.append("claim cites no evidence")
    missing = [item for item in cited if item not in evidence]
    for item in missing:
        reasons.append(f"unknown evidence id {item}")

    allowed = collect_numbers({key: evidence[key] for key in cited if key in evidence})
    narratives = moment.get("narratives") or {}
    for text in _strings(narratives):
        for stray in stray_decimals(text, allowed):
            reasons.append(f"decimal {stray} is not in the cited evidence")

    for option in [moment.get("taken"), *(moment.get("alternatives") or [])]:
        if not option:
            continue
        evidence_id = option.get("evidence_id")
        record = evidence.get(evidence_id) if evidence_id else None
        if record is None:
            reasons.append(f"option {option.get('id')} has no evidence record")
            continue
        for field in ("decision_score", "expected_value"):
            if field in option and field in record:
                if abs(float(option[field]) - float(record[field])) > 1e-6:
                    reasons.append(f"{option.get('id')} {field} does not match {evidence_id}")
    # Preserve order while dropping duplicates.
    seen: set[str] = set()
    unique: list[str] = []
    for reason in reasons:
        if reason not in seen:
            seen.add(reason)
            unique.append(reason)
    return unique
