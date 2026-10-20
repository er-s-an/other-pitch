"""Build the timed overlay and check its shape."""

from __future__ import annotations

import math

from otherpitch.analytics import fmt

SOURCES = {"synthetic_tracking", "model_estimate"}
MODES = ("casual", "analyst", "zh")


def _curve(start: dict, end: dict, bend: float, seconds: float = 1.6) -> list[dict]:
    x0, y0 = float(start["x"]), float(start["y"])
    x2, y2 = float(end["x"]), float(end["y"])
    mx, my = (x0 + x2) / 2.0, (y0 + y2) / 2.0
    dx, dy = x2 - x0, y2 - y0
    length = math.hypot(dx, dy) or 1.0
    cx = mx + (-dy / length) * bend
    cy = my + (dx / length) * bend
    steps = int(round(seconds * 25))
    points = []
    for index in range(steps + 1):
        u = index / steps
        omu = 1.0 - u
        x = omu * omu * x0 + 2 * omu * u * cx + u * u * x2
        y = omu * omu * y0 + 2 * omu * u * cy + u * u * y2
        points.append({"t": round(index / 25, 6), "x": round(x, 3), "y": round(y, 3)})
    return points


def _ghost(option: dict) -> dict:
    bend = 7.0 if option["kind"] == "shot" else 4.5
    seconds = 1.15 if option["kind"] == "shot" else 1.6
    return {
        "id": f"ghost_{option['id']}",
        "option_id": option["id"],
        "kind": option["kind"],
        "source": "synthetic_tracking",
        "receiver_id": option.get("receiver_id"),
        "points": _curve(option["start"], option["end"], bend, seconds),
        "probability": option["decision_score"],
        "label": {
            "text": option["label_text"],
            "source": "model_estimate",
            "name": "expected value" if option["kind"] == "pass" else "expected goals",
        },
    }


def build_timeline(state: dict) -> dict:
    generated = state["generated"]
    moment = state["moment"]
    taken = moment["taken"]
    return {
        "match": generated["match"],
        "players": generated["players"],
        "events": generated["events"],
        "phase": generated["phase"],
        "modes": list(MODES),
        "moment": {
            "event_id": moment["event_id"],
            "actor_id": moment["actor_id"],
            "frame_index": moment["frame_index"],
            "taken_id": taken["id"],
            "alternative_ids": [item["id"] for item in moment["alternatives"]],
            "evidence_ids": moment["evidence_ids"],
        },
        "decision_frame": moment["frame_index"],
        "decision_t": generated["phase"]["decision_t"],
        "frames": generated["frames"],
        "taken": _public_option(taken),
        "alternatives": [_public_option(item) for item in moment["alternatives"]],
        "ghosts": [_ghost(item) for item in moment["alternatives"]],
        "quiz": {
            "correct_id": taken["id"],
            "options": [_quiz_option(item) for item in moment["quiz_options"]],
        },
        "copy": moment["narratives"],
        "legend": [
            {"source": "synthetic_tracking", "label": "Synthetic tracking"},
            {"source": "model_estimate", "label": "Model estimate"},
        ],
        "fictional": True,
    }


def _public_option(option: dict) -> dict:
    return {
        "id": option["id"],
        "kind": option["kind"],
        "player_id": option["player_id"],
        "receiver_id": option.get("receiver_id"),
        "evidence_id": option["evidence_id"],
        "taken": option["taken"],
        "decision_score": option["decision_score"],
        "expected_value": option["expected_value"],
        "xg": option["xg"],
        "completion": option.get("completion"),
        "label_text": option["label_text"],
        "start": option["start"],
        "end": option["end"],
        "source": "model_estimate",
    }


def _quiz_option(option: dict) -> dict:
    return {
        "id": option["id"],
        "kind": option["kind"],
        "receiver_id": option.get("receiver_id"),
        "end": option["end"],
        "label_text": option["label_text"],
        "label_source": "model_estimate",
    }


def shape_mode(timeline: dict, mode: str) -> dict:
    mode = normalize_mode(mode)
    copy = timeline["copy"][mode]
    options = []
    for option in timeline["quiz"]["options"]:
        options.append({**option, "label": copy["options"][option["id"]]})
    return {
        "mode": mode,
        "match": timeline["match"],
        "players": timeline["players"],
        "moment": {**timeline["moment"], "caption": copy["caption"], "reveal": copy["reveal"]},
        "decision_frame": timeline["decision_frame"],
        "decision_t": timeline["decision_t"],
        "frames": timeline["frames"],
        "taken": timeline["taken"],
        "alternatives": timeline["alternatives"],
        "ghosts": timeline["ghosts"],
        "quiz": {
            "prompt": copy["quiz_prompt"],
            "correct_id": timeline["quiz"]["correct_id"],
            "verdict_right": copy["verdict_right"],
            "verdict_wrong": copy["verdict_wrong"],
            "options": options,
        },
        "legend": timeline["legend"],
        "fictional": True,
    }


def normalize_mode(mode: str) -> str:
    key = (mode or "casual").strip().lower()
    if key in {"zh", "chinese", "cn", "中文"}:
        return "zh"
    if key in {"analyst", "analysis", "pro"}:
        return "analyst"
    if key in {"casual", "fan", "broadcast"}:
        return "casual"
    raise ValueError(f"unknown mode {mode!r}")


def validate_timeline(doc: dict) -> list[str]:
    errors: list[str] = []
    frames = doc.get("frames") or []
    if len(frames) < 50:
        errors.append("too few frames")
    for index, frame in enumerate(frames):
        if frame.get("source") != "synthetic_tracking":
            errors.append(f"frame {index} source")
            break
        ball = frame.get("ball") or {}
        if "x" not in ball or "y" not in ball:
            errors.append(f"frame {index} ball")
            break
        if len(frame.get("players") or []) != 22:
            errors.append(f"frame {index} players")
            break
    if len(frames) >= 2:
        step = frames[1]["t"] - frames[0]["t"]
        if round(step, 6) != round(1 / 25, 6):
            errors.append(f"frame step {step} is not 25 Hz")
    decision = doc.get("decision_frame")
    if not isinstance(decision, int) or not (0 < decision < len(frames) - 1):
        errors.append("decision frame")
    ghosts = doc.get("ghosts") or []
    kinds = {ghost.get("kind") for ghost in ghosts}
    if "pass" not in kinds or "shot" not in kinds:
        errors.append("ghosts need a pass and a shot")
    for ghost in ghosts:
        if ghost.get("source") not in SOURCES:
            errors.append(f"ghost {ghost.get('id')} source")
        label = ghost.get("label") or {}
        if label.get("source") not in SOURCES:
            errors.append(f"ghost {ghost.get('id')} label source")
        if not isinstance(label.get("text"), str) or not label.get("text"):
            errors.append(f"ghost {ghost.get('id')} label text")
        points = ghost.get("points") or []
        if len(points) < 10:
            errors.append(f"ghost {ghost.get('id')} points")
        if not isinstance(ghost.get("probability"), (int, float)):
            errors.append(f"ghost {ghost.get('id')} probability")
        elif fmt(float(ghost["probability"])) != label.get("text"):
            errors.append(f"ghost {ghost.get('id')} label does not match probability")
    copy = doc.get("copy") or {}
    for mode in MODES:
        if mode not in copy:
            errors.append(f"missing copy {mode}")
    if doc.get("fictional") is not True:
        errors.append("fictional flag")
    return errors
