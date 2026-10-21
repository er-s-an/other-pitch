"""Snapshot -> per-action branch: 2D motion, analytic outcome tree, metrics.

Every branch starts from a copy of the same frozen snapshot (same state_hash, same t0).
Metric definitions (section 8.1 of docs/PLAN-v2.md):
  p_complete        initial pass reaches the target team-mate (null for shots)
  p_lose_possession possession lost before the window ends or the first shot
  q_shot            synthetic 0-1 shot-quality score at the moment of the shot
  opportunity_value V = sum over leaves of probability * shot_quality, 8 s window
None of these is a calibrated goal probability. Coefficients come from analytics.py.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math

from otherpitch.analytics import (
    PITCH_LENGTH, PITCH_WIDTH, clamp, expected_goals, lane_block, pass_completion, pressure_at,
)
from otherpitch.v2 import ENGINE_VERSION, HORIZON_S, POLICY_VERSION

DT = 0.1
LEADIN_S = 3.0
BALL_SPEED = 16.0       # m/s, ground pass, capped
RUN_SPEED = 7.0         # receiver max speed
DEF_SPEED = 6.0         # defender max speed
DEF_REACTION_S = 0.4    # public reaction delay
CONTROL_S = 0.6         # first touch before the follow-up policy acts
SHOT_WINDUP_S = 0.3
CARRY_SPEED = 5.0
SHOOT_RANGE_M = 18.0
RECYCLE_PRESSURE = 0.85  # policy: under this much pressure on receipt, no shot is attempted
GOAL_X = PITCH_LENGTH

REQUIRED_PLAYER_FIELDS = ("id", "team", "x", "y")


class InvalidSnapshot(ValueError):
    def __init__(self, missing_fields: list[str], reasons: list[str]):
        self.missing_fields = missing_fields
        self.reasons = reasons
        super().__init__("; ".join(reasons) or "invalid snapshot")


def canonical_hash(obj) -> str:
    raw = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return "sha256:" + hashlib.sha256(raw.encode()).hexdigest()


def _state_core(scn: dict) -> dict:
    return {"scenario_id": scn["scenario_id"], "carrier_id": scn.get("carrier_id"),
            "players": scn.get("players"), "actions": scn.get("actions")}


def validate_scenario(scn: dict) -> None:
    missing, reasons = [], []
    players = scn.get("players") or []
    ids = {}
    for i, p in enumerate(players):
        for f in REQUIRED_PLAYER_FIELDS:
            if p.get(f) is None:
                missing.append(f"players[{i}].{f}")
        if p.get("x") is not None and p.get("y") is not None:
            if not (0 <= p["x"] <= PITCH_LENGTH and 0 <= p["y"] <= PITCH_WIDTH):
                reasons.append(f"{p.get('id')} is off the pitch")
        ids[p.get("id")] = p
    carrier = ids.get(scn.get("carrier_id"))
    if carrier is None:
        missing.append("carrier_id")
    elif carrier.get("team") != "home":
        reasons.append("carrier is not on the attacking team")
    for a in scn.get("actions") or []:
        if a["type"] == "pass":
            r = ids.get(a.get("receiver_id"))
            if r is None:
                missing.append(f"actions.{a['action_id']}.receiver_id")
            elif r.get("team") != "home":
                reasons.append(f"{a['action_id']} targets an opponent")
            tx, ty = a["target"]
            if not (0 <= tx <= PITCH_LENGTH and 0 <= ty <= PITCH_WIDTH):
                reasons.append(f"{a['action_id']} target is off the pitch")
            # Scenario constraint instead of a full offside engine: receiver target must not
            # be beyond the second-last defender at t0.
            dxs = sorted((p["x"] for p in players if p.get("team") == "away" and p.get("x") is not None), reverse=True)
            if len(dxs) >= 2 and r is not None and r.get("x") is not None and r["x"] > dxs[1] + 0.01:
                reasons.append(f"{a['action_id']} receiver starts offside")
    if missing or reasons:
        raise InvalidSnapshot(missing, reasons)


def make_snapshot(scn: dict, variant_id: str = "base") -> dict:
    """Apply at most one declared intervention and freeze the decision state."""
    validate_scenario(scn)
    base_hash = canonical_hash(_state_core(scn))
    snap = copy.deepcopy(scn)
    intervention = None
    if variant_id != "base":
        spec = next((i for i in scn.get("interventions", []) if i["variant_id"] == variant_id), None)
        if spec is None:
            raise KeyError(f"variant {variant_id!r} is not declared for {scn['scenario_id']}")
        player = next(p for p in snap["players"] if p["id"] == spec["subject_id"])
        before = [player["x"], player["y"]]
        player["x"], player["y"] = float(spec["after"][0]), float(spec["after"][1])
        player["vx"] = player["vy"] = 0.0
        intervention = {
            "intervention_id": spec["intervention_id"], "variant_id": variant_id,
            "label": spec["label"], "subject_id": spec["subject_id"],
            "field_changes": [{"field": f"players[{spec['subject_id']}].position", "before": before, "after": list(spec["after"])},
                              {"field": f"players[{spec['subject_id']}].velocity", "before": "unchanged-run", "after": [0.0, 0.0],
                               "note": "a set defender holds the lane; part of the same position change"}],
            "allowed_range": spec["allowed_range"], "base_state_hash": base_hash,
        }
        validate_scenario(snap)
    snap["variant_id"] = variant_id
    snap["t0"] = 0.0
    snap["provenance"] = "synthetic_observation"
    snap["intervention"] = intervention
    snap["base_state_hash"] = base_hash
    snap["state_hash"] = canonical_hash(_state_core(snap))
    return snap


# ---------- motion helpers ----------

def _step_toward(x, y, tx, ty, speed, dt=DT):
    d = math.hypot(tx - x, ty - y)
    if d < 1e-6:
        return tx, ty
    s = min(d, speed * dt)
    return x + (tx - x) / d * s, y + (ty - y) / d * s


def _clip(x, y):
    return clamp(x, 0.0, PITCH_LENGTH), clamp(y, 0.0, PITCH_WIDTH)


def _closest_on_segment(px, py, ax, ay, bx, by):
    abx, aby = bx - ax, by - ay
    ab2 = abx * abx + aby * aby or 1e-9
    t = clamp(((px - ax) * abx + (py - ay) * aby) / ab2, 0.0, 1.0)
    return ax + t * abx, ay + t * aby, t


class World:
    def __init__(self, snap):
        self.players = {p["id"]: dict(p) for p in snap["players"]}
        self.key = set(snap.get("key_defender_ids", []))
        c = self.players[snap["carrier_id"]]
        self.ball = [c["x"] + 0.6, c["y"]]
        self.t = 0.0
        self.frames = []
        self.events = []

    def opponents(self):
        return [(p["x"], p["y"]) for p in self.players.values() if p["team"] == "away"]

    def record(self):
        self.frames.append({"t": round(self.t, 2), "ball": [round(self.ball[0], 2), round(self.ball[1], 2)],
                            "p": {pid: [round(p["x"], 2), round(p["y"], 2)] for pid, p in self.players.items()}})

    def drift(self, skip=()):
        for pid, p in self.players.items():
            if pid in skip:
                continue
            p["x"], p["y"] = _clip(p["x"] + p["vx"] * DT, p["y"] + p["vy"] * DT)
            p["vx"] *= 0.97
            p["vy"] *= 0.97

    def defenders_press(self, tx, ty, react_from, ids=None):
        """Away players (key ones first) close toward (tx, ty) after the reaction delay."""
        moved = set()
        if self.t < react_from:
            return moved
        for pid, p in self.players.items():
            if p["team"] != "away" or p["role"] == "GK":
                continue
            if ids is not None and pid not in ids:
                continue
            p["x"], p["y"] = _step_toward(p["x"], p["y"], tx, ty, DEF_SPEED)
            moved.add(pid)
        return moved

    def tick(self):
        self.t = round(self.t + DT, 6)
        self.record()


def _nearest_away(world, x, y, n=2):
    away = [(math.hypot(p["x"] - x, p["y"] - y), pid) for pid, p in world.players.items()
            if p["team"] == "away" and p["role"] != "GK"]
    return [pid for _, pid in sorted(away)[:n]]


def _shoot(world, shooter_id, pressers):
    """Wind up, then evaluate shot quality at the moment the ball is struck."""
    s = world.players[shooter_id]
    end = world.t + SHOT_WINDUP_S
    while world.t < end - 1e-9 and world.t < HORIZON_S - 1e-9:
        world.defenders_press(s["x"], s["y"], 0.0, pressers)
        world.drift(skip=set(pressers) | {shooter_id})
        world.ball = [s["x"] + 0.6, s["y"]]
        world.tick()
    if world.t > HORIZON_S + 1e-9:
        return None
    pressure = pressure_at(s["x"], s["y"], world.opponents())
    q = expected_goals(s["x"], s["y"], GOAL_X, pressure)
    world.events.append({"t": round(world.t, 2), "type": "shot", "player_id": shooter_id,
                         "x": round(s["x"], 2), "y": round(s["y"], 2), "pressure": round(pressure, 4)})
    # Show the strike: ball travels toward goal for a few frames; branch stops there (no goal animation).
    gx, gy = GOAL_X, 34.0
    for _ in range(6):
        world.ball = list(_step_toward(world.ball[0], world.ball[1], gx, gy, 24.0))
        world.drift(skip={shooter_id})
        world.tick()
    return q, pressure, round(world.t - 0.6, 2)


def simulate_action(snap: dict, action: dict) -> dict:
    """Return the branch: outcome tree, metrics, representative trajectory."""
    world = World(snap)
    world.record()
    actor = world.players[action["actor_id"]]
    leaves = []
    rep_kind = ""
    if action["type"] == "shot":
        pressers = _nearest_away(world, actor["x"], actor["y"], 2)
        res = _shoot(world, actor["id"], pressers)
        q, pressure, t_shot = res
        leaves.append({"leaf_id": "shot", "end_reason": "shot", "probability": 1.0, "elapsed_s": t_shot,
                       "shot_quality": round(q, 4), "initial_pass_completed": None, "possession_lost": False,
                       "shooter_id": actor["id"]})
        inputs = {"shot_pressure": round(pressure, 4), "shot_distance_m": round(math.hypot(GOAL_X - actor["x"], 34 - actor["y"]), 2)}
        rep_kind = "shot"
        p_complete = None
    else:
        rx, ry = action["target"]
        sx, sy = world.ball
        dist = math.hypot(rx - sx, ry - sy)
        lane = lane_block(sx, sy, rx, ry, [(p["x"], p["y"]) for p in world.players.values()
                                            if p["team"] == "away" and p["role"] != "GK"])
        # Receiver pressure is measured where the ball arrives, with defenders' positions after
        # they react for the flight time (same public policy for every branch).
        flight = dist / BALL_SPEED
        recv = world.players[action["receiver_id"]]
        probe = World(snap)
        steps = int(round(flight / DT))
        for _ in range(steps):
            probe.t += DT
            probe.defenders_press(rx, ry, DEF_REACTION_S, set(_nearest_away(probe, rx, ry, 2)))
        recv_pressure = pressure_at(rx, ry, probe.opponents())
        p_complete = pass_completion(dist, lane, recv_pressure)
        # Blocking defender: the away outfield player nearest to the pass line.
        blockers = sorted(((math.hypot(*(lambda c: (c[0] - p["x"], c[1] - p["y"]))(_closest_on_segment(p["x"], p["y"], sx, sy, rx, ry)[:2])), pid)
                           for pid, p in world.players.items() if p["team"] == "away" and p["role"] != "GK"))
        blocker_id = blockers[0][1]
        inputs = {"pass_distance_m": round(dist, 2), "lane_block": round(lane, 4),
                  "receiver_pressure_on_arrival": round(recv_pressure, 4), "blocking_defender_id": blocker_id,
                  "blocking_defender_distance_m": round(blockers[0][0], 2)}
        # Two representative worlds: completed and intercepted. Show the more likely one.
        completed = p_complete >= 0.5
        # Interception leaf
        t_int = None
        bp = world.players[blocker_id]
        ix, iy, it = _closest_on_segment(bp["x"], bp["y"], sx, sy, rx, ry)
        t_int = round(DEF_REACTION_S + max(it * flight, 0.3), 2)
        leaves.append({"leaf_id": "intercepted", "end_reason": "turnover", "probability": round(1 - p_complete, 6),
                       "elapsed_s": t_int, "shot_quality": None, "initial_pass_completed": False,
                       "possession_lost": True, "interceptor_id": blocker_id})
        # Completed: run the follow-up policy in its own world.
        cw = world if completed else World(snap)
        if not completed:
            cw.record()
        follow = _play_pass(cw, snap, action, flight, rx, ry)
        if completed:
            rep_kind = "completed_" + follow["end_reason"]
        p_shot = 1.0 if follow["end_reason"] == "shot" else 0.0
        leaves.append({"leaf_id": "completed_" + follow["end_reason"], "end_reason": follow["end_reason"],
                       "probability": round(p_complete * p_shot, 6) if p_shot else round(p_complete, 6),
                       "elapsed_s": follow["elapsed_s"], "shot_quality": follow.get("q"),
                       "initial_pass_completed": True, "possession_lost": False,
                       "shooter_id": action["receiver_id"] if p_shot else None})
        if p_shot == 0.0:
            pass
        inputs.update({"receipt_pressure": follow.get("receipt_pressure"),
                       "p_shot_given_complete": p_shot,
                       "q_shot_given_complete_and_shot": follow.get("q")})
        if not completed:
            world.frames, world.events = [], []
            world = World(snap)
            world.record()
            _play_intercept(world, snap, action, flight, rx, ry, blocker_id, (ix, iy), it)
            rep_kind = "intercepted"
    total = sum(l["probability"] for l in leaves)
    # Exact conservation: absorb float rounding into the last leaf.
    leaves[-1]["probability"] = round(leaves[-1]["probability"] + (1.0 - total), 6)
    shots = [l for l in leaves if l["end_reason"] == "shot"]
    V = sum(l["probability"] * l["shot_quality"] for l in shots)
    p_shot_total = sum(l["probability"] for l in shots)
    q_cond = (V / p_shot_total) if p_shot_total > 0 else None
    p_lose = sum(l["probability"] for l in leaves if l["possession_lost"])
    metrics = {
        "p_complete": None if p_complete is None else round(p_complete, 4),
        "p_lose_possession": round(p_lose, 4),
        "q_shot": None if q_cond is None else round(q_cond, 4),
        "opportunity_value": round(V, 4),
    }
    return {
        "action_id": action["action_id"],
        "variant_id": snap["variant_id"],
        "model_version": ENGINE_VERSION, "policy_version": POLICY_VERSION, "horizon_s": HORIZON_S,
        "base_state_hash": snap["base_state_hash"], "state_hash": snap["state_hash"], "t0": snap["t0"],
        "outcome_tree": {"root": action["action_id"], "leaves": leaves},
        "metrics": metrics, "inputs": inputs,
        "trajectory": {"kind": "representative_simulation", "leaf": rep_kind, "dt": DT,
                       "frames": world.frames, "events": world.events},
    }


def _play_pass(world, snap, action, flight, rx, ry):
    sx, sy = world.ball
    rid = action["receiver_id"]
    recv = world.players[rid]
    world.events.append({"t": 0.0, "type": "pass", "from": action["actor_id"], "to": rid, "target": [rx, ry]})
    pressers = set(_nearest_away(world, rx, ry, 2))
    while world.t < flight - 1e-9:
        world.ball = list(_step_toward(world.ball[0], world.ball[1], rx, ry, BALL_SPEED))
        recv["x"], recv["y"] = _step_toward(recv["x"], recv["y"], rx, ry, RUN_SPEED)
        world.defenders_press(rx, ry, DEF_REACTION_S, pressers)
        world.drift(skip=pressers | {rid})
        world.tick()
    world.ball = [rx, ry]
    recv["x"], recv["y"] = rx, ry
    receipt_pressure = pressure_at(rx, ry, world.opponents())
    world.events.append({"t": round(world.t, 2), "type": "receive", "player_id": rid})
    # Control touch.
    end = world.t + CONTROL_S
    while world.t < end - 1e-9:
        world.defenders_press(recv["x"], recv["y"], 0.0, pressers)
        world.drift(skip=pressers | {rid})
        world.tick()
    if receipt_pressure >= RECYCLE_PRESSURE:
        return _timeout(world, rid, pressers, receipt_pressure, "recycled under pressure")
    # Carry toward the penalty spot until in range.
    while math.hypot(GOAL_X - recv["x"], 34 - recv["y"]) > SHOOT_RANGE_M and world.t < HORIZON_S - SHOT_WINDUP_S - 1e-9:
        recv["x"], recv["y"] = _step_toward(recv["x"], recv["y"], 94.0, 34.0, CARRY_SPEED)
        world.ball = [recv["x"] + 0.6, recv["y"]]
        world.defenders_press(recv["x"], recv["y"], 0.0, pressers)
        world.drift(skip=pressers | {rid})
        world.tick()
    if math.hypot(GOAL_X - recv["x"], 34 - recv["y"]) > SHOOT_RANGE_M:
        return _timeout(world, rid, pressers, receipt_pressure, "no shot inside the window")
    q, pressure, t_shot = _shoot(world, rid, list(pressers))
    return {"end_reason": "shot", "elapsed_s": t_shot, "q": round(q, 4), "receipt_pressure": round(receipt_pressure, 4)}


def _timeout(world, rid, pressers, receipt_pressure, why):
    while world.t < HORIZON_S - 1e-9 and len(world.frames) < 40 + len(world.frames) * 0:
        if world.t > 3.5:  # hold briefly; the window end is reported, not animated in full
            break
        world.drift(skip={rid})
        world.tick()
    world.events.append({"t": round(world.t, 2), "type": "no_shot", "player_id": rid, "note": why})
    return {"end_reason": "timeout", "elapsed_s": HORIZON_S, "q": None, "receipt_pressure": round(receipt_pressure, 4)}


def _play_intercept(world, snap, action, flight, rx, ry, blocker_id, point, frac):
    rid = action["receiver_id"]
    recv = world.players[rid]
    bp = world.players[blocker_id]
    ix, iy = point
    world.events.append({"t": 0.0, "type": "pass", "from": action["actor_id"], "to": rid, "target": [rx, ry]})
    reached = False
    while world.t < 4.0:
        if not reached:
            world.ball = list(_step_toward(world.ball[0], world.ball[1], rx, ry, BALL_SPEED))
            if world.t >= DEF_REACTION_S:
                bp["x"], bp["y"] = _step_toward(bp["x"], bp["y"], ix, iy, DEF_SPEED * 1.2)
            if math.hypot(world.ball[0] - bp["x"], world.ball[1] - bp["y"]) < 1.2 or math.hypot(world.ball[0] - rx, world.ball[1] - ry) < 0.5:
                reached = True
                world.ball = [bp["x"], bp["y"]]
                world.events.append({"t": round(world.t, 2), "type": "interception", "player_id": blocker_id})
                hold = world.t + 0.8
        else:
            bp["x"], bp["y"] = _step_toward(bp["x"], bp["y"], bp["x"] - 6, bp["y"], 5.0)
            world.ball = [bp["x"] - 0.6, bp["y"]]
            if world.t >= hold:
                break
        recv["x"], recv["y"] = _step_toward(recv["x"], recv["y"], rx, ry, RUN_SPEED)
        world.drift(skip={rid, blocker_id})
        world.tick()


def leadin_frames(snap: dict) -> list[dict]:
    """Shared approach: positions extrapolated back from the t0 velocities. Same for every branch."""
    frames = []
    n = int(round(LEADIN_S / DT))
    carrier = snap["carrier_id"]
    for k in range(n, 0, -1):
        t = -k * DT
        pos = {}
        for p in snap["players"]:
            pos[p["id"]] = [round(clamp(p["x"] + p["vx"] * t, 0, PITCH_LENGTH), 2), round(clamp(p["y"] + p["vy"] * t, 0, PITCH_WIDTH), 2)]
        c = pos[carrier]
        frames.append({"t": round(t, 2), "ball": [c[0] + 0.6, c[1]], "p": pos})
    return frames


def simulate_all(snap: dict) -> list[dict]:
    return [simulate_action(snap, a) for a in snap["actions"]]
