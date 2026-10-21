"""Typed claim validation: whose value, which metric, which unit, which window."""

from __future__ import annotations

import re

from otherpitch.v2 import DEFINITION_VERSION, HORIZON_S
from otherpitch.v2.evidence import METRICS, display

NUM = re.compile(r"\d+(?:\.\d+)?\s*(?:%|/\s*100)?")
FORBIDDEN = [r"goal probability", r"chance of scoring", r"probability of (a )?goal", r"will score", r"% to score", r"xg"]


def validate_claim(claim: dict, ev_book: dict, expected_subject: dict | None = None) -> list[str]:
    errors = []
    ev = ev_book.get(claim.get("evidence_id"))
    if ev is None:
        return [f"{claim.get('claim_id')}: evidence {claim.get('evidence_id')!r} not in this bundle"]
    if claim.get("metric_id") != ev["evidence_id"]:
        errors.append(f"{claim['claim_id']}: metric_id does not match evidence_id")
    for k in ("scenario_id", "variant_id", "action_id"):
        if claim.get("subject", {}).get(k) != ev["subject"][k]:
            errors.append(f"{claim['claim_id']}: subject.{k}={claim.get('subject', {}).get(k)!r} but evidence is about {ev['subject'][k]!r}")
        if expected_subject and k in expected_subject and claim.get("subject", {}).get(k) != expected_subject[k]:
            errors.append(f"{claim['claim_id']}: subject.{k} does not match the scene being explained")
    if claim.get("metric_name") != ev["metric_name"]:
        errors.append(f"{claim['claim_id']}: metric {claim.get('metric_name')!r} borrowed from {ev['metric_name']!r}")
    if claim.get("unit") != ev["unit"] or claim.get("unit") != METRICS.get(ev["metric_name"], {}).get("unit"):
        errors.append(f"{claim['claim_id']}: unit {claim.get('unit')!r} should be {ev['unit']!r}")
    try:
        if abs(float(claim.get("raw_value")) - float(ev["value"])) > 1e-6:
            errors.append(f"{claim['claim_id']}: raw_value {claim.get('raw_value')} != evidence {ev['value']}")
    except (TypeError, ValueError):
        errors.append(f"{claim['claim_id']}: raw_value is not numeric")
    if claim.get("display_value") != display(ev["metric_name"], ev["value"]):
        errors.append(f"{claim['claim_id']}: display {claim.get('display_value')!r} should be {display(ev['metric_name'], ev['value'])!r}")
    if claim.get("definition_version") != DEFINITION_VERSION:
        errors.append(f"{claim['claim_id']}: definition_version mismatch")
    if claim.get("time_window_s") != HORIZON_S:
        errors.append(f"{claim['claim_id']}: time window mismatch")
    label = str(claim.get("label", "")).lower()
    if ev["unit"] == "normalized_score" and ("probab" in label or "%" in str(claim.get("display_value"))):
        errors.append(f"{claim['claim_id']}: a normalized score is labelled as a probability")
    return errors


def validate_text(text: str, allowed_displays: list[str]) -> list[str]:
    """Free text may contain no numbers except the display values of claims it cites."""
    errors = []
    low = text.lower()
    for pat in FORBIDDEN:
        if re.search(pat, low):
            errors.append(f"text uses forbidden phrase /{pat}/")
    scrub = text
    for d in sorted(allowed_displays, key=len, reverse=True):
        scrub = scrub.replace(d, "")
    for m in NUM.finditer(scrub):
        errors.append(f"text introduces unbound number {m.group(0).strip()!r}")
    return errors


def validate_explanation(spec: dict, ev_book: dict, scene_subject: dict) -> list[str]:
    errors = []
    by_id = {c["claim_id"]: c for c in spec["claims"]}
    for c in spec["claims"]:
        errors += validate_claim(c, ev_book, {k: scene_subject[k] for k in ("scenario_id", "variant_id")})
    for ref in spec["casual"]["metric_claim_ids"]:
        if ref not in by_id:
            errors.append(f"casual cites unknown claim {ref}")
    for line in spec["analyst"]["lines"]:
        for ref in line["claim_ids"]:
            if ref not in by_id:
                errors.append(f"analyst cites unknown claim {ref}")
            elif by_id[ref]["subject"]["action_id"] != line["action_id"]:
                errors.append(f"analyst line for {line['action_id']} cites a value about {by_id[ref]['subject']['action_id']}")
    for mode in ("casual", "analyst"):
        for field in ("headline", "sentence"):
            errors += [f"{mode}.{field}: {e}" for e in validate_text(spec[mode][field], [])]
    return errors
