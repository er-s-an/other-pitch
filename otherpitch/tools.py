"""Functions behind the MCP tools. Tests call these directly."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from otherpitch.timeline import shape_mode

_TIMELINE: dict[str, Any] | None = None
_TRACE: dict[str, Any] | None = None


def bind(timeline: dict[str, Any], trace: dict[str, Any] | None = None) -> None:
    global _TIMELINE, _TRACE
    _TIMELINE = timeline
    _TRACE = trace


def load_directory(path: str | Path) -> dict[str, Any]:
    folder = Path(path)
    timeline = json.loads((folder / "timeline.json").read_text(encoding="utf-8"))
    trace_path = folder / "trace.json"
    trace = json.loads(trace_path.read_text(encoding="utf-8")) if trace_path.exists() else None
    bind(timeline, trace)
    return timeline


def _timeline() -> dict[str, Any]:
    if _TIMELINE is None:
        raise RuntimeError("no match is loaded; call load_directory or bind first")
    return _TIMELINE


def get_match_state() -> dict[str, Any]:
    """Match header, phase, and the moment the director kept."""
    timeline = _timeline()
    return {
        "match": timeline["match"],
        "phase": timeline["phase"],
        "moment": timeline["moment"],
        "players": timeline["players"],
        "modes": timeline["modes"],
        "fictional": True,
        "qa": None
        if _TRACE is None
        else {
            "rejections": _TRACE.get("qa_rejections"),
            "passed": _TRACE.get("qa_passed"),
            "framework": _TRACE.get("framework"),
        },
    }


def list_events() -> list[dict[str, Any]]:
    """Every synthetic event in the match, in kickoff order."""
    return list(_timeline()["events"])


def get_moment() -> dict[str, Any]:
    """The decision the replay stops on, including who was on the ball."""
    timeline = _timeline()
    return {
        "moment": timeline["moment"],
        "taken": timeline["taken"],
        "decision_frame": timeline["decision_frame"],
        "decision_t": timeline["decision_t"],
    }


def get_alternatives() -> list[dict[str, Any]]:
    """The two untaken actions, one pass and one shot."""
    return list(_timeline()["alternatives"])


def get_timeline(mode: str = "casual") -> dict[str, Any]:
    """Replay document for casual, analyst, or zh."""
    return shape_mode(_timeline(), mode)
