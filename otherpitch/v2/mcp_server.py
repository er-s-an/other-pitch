"""Other Pitch v2 MCP server (stdio). Tools return typed, versioned evidence.

    python -m otherpitch.v2.mcp_server
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from otherpitch.v2 import ENGINE_VERSION
from otherpitch.v2.evidence import branch_evidence
from otherpitch.v2.scenarios import get_scenario, variants
from otherpitch.v2.simulation import InvalidSnapshot, make_snapshot, simulate_action

mcp = FastMCP("otherpitch-v2", instructions=(
    "Fictional football decision snapshots and a transparent toy branch simulator. "
    "All data is synthetic. Values are internal model estimates, not goal probabilities."))


def _snap(snapshot_id: str) -> dict:
    scene, _, variant = snapshot_id.partition(":")
    return make_snapshot(get_scenario(scene), variant or "base")


def _public_snapshot(s: dict) -> dict:
    keep = ("scenario_id", "scenario_version", "variant_id", "t0", "clock", "score", "carrier_id", "players",
            "key_defender_ids", "provenance", "intervention", "base_state_hash", "state_hash", "recorded_action_id")
    return {k: s.get(k) for k in keep}


@mcp.tool()
def get_decision_snapshot(scenario_id: str, variant_id: str = "base", t0: float = 0.0) -> dict:
    """Frozen decision state for a scenario/variant, with provenance and integrity status."""
    try:
        if variant_id not in variants(scenario_id):
            return {"status": "rejected", "reason": f"variant {variant_id} not declared", "missing_fields": []}
        s = make_snapshot(get_scenario(scenario_id), variant_id)
    except InvalidSnapshot as e:
        return {"status": "rejected_input", "missing_fields": e.missing_fields, "reasons": e.reasons}
    except KeyError as e:
        return {"status": "rejected", "reason": str(e), "missing_fields": []}
    return {"status": "ok", "snapshot_id": f"{scenario_id}:{variant_id}", "snapshot": _public_snapshot(s)}


@mcp.tool()
def list_legal_actions(snapshot_id: str) -> dict:
    """Validated actions for a snapshot and any unavailable reasons."""
    s = _snap(snapshot_id)
    return {"snapshot_id": snapshot_id, "state_hash": s["state_hash"],
            "actions": [{k: a[k] for k in ("action_id", "type", "actor_id", "receiver_id", "target", "label")} for a in s["actions"]],
            "unavailable": [{"type": "cross_aerial", "reason": "P0 supports ground passes and shots only"}]}


@mcp.tool()
def simulate_branch(snapshot_id: str, action_id: str, model_version: str = ENGINE_VERSION, include_frames: bool = False) -> dict:
    """Run one action from the frozen snapshot. Returns outcome tree, metrics and evidence ids."""
    if model_version != ENGINE_VERSION:
        return {"status": "rejected", "reason": f"model_version {model_version} not available; use {ENGINE_VERSION}"}
    s = _snap(snapshot_id)
    action = next((a for a in s["actions"] if a["action_id"] == action_id), None)
    if action is None:
        return {"status": "rejected", "reason": f"unknown action {action_id}"}
    b = simulate_action(s, action)
    ev = branch_evidence(s, b)
    if not include_frames:
        b = dict(b)
        b["trajectory"] = {k: v for k, v in b["trajectory"].items() if k != "frames"} | {"frame_count": len(b["trajectory"]["frames"])}
    return {"status": "ok", "branch_ref": f"{snapshot_id}:{action_id}:{ENGINE_VERSION}", "branch": b,
            "metric_evidence_ids": sorted(ev)}


@mcp.tool()
def get_evidence(evidence_ids: list[str]) -> dict:
    """Facts with metric name, unit, subject, window and definition for each evidence id."""
    out, missing = {}, []
    cache: dict[str, dict] = {}
    for eid in evidence_ids:
        try:
            _, scene, variant, action, metric = eid.split(":")
        except ValueError:
            missing.append(eid)
            continue
        key = f"{scene}:{variant}:{action}"
        if key not in cache:
            try:
                s = make_snapshot(get_scenario(scene), variant)
                a = next(a for a in s["actions"] if a["action_id"] == action)
                cache[key] = branch_evidence(s, simulate_action(s, a))
            except (KeyError, StopIteration, InvalidSnapshot):
                cache[key] = {}
        if eid in cache[key]:
            out[eid] = cache[key][eid]
        else:
            missing.append(eid)
    return {"evidence": out, "missing": missing}


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
