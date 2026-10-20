"""Turn the decision frame into a shot and a pass for every teammate."""

from __future__ import annotations

from otherpitch.analytics import (
    PITCH_LENGTH,
    expected_goals,
    fmt,
    goal_angle,
    lane_block,
    pass_completion,
    pass_expected_value,
    pressure_at,
)


def _xy(frame: dict, player_id: str) -> tuple[float, float]:
    for player in frame["players"]:
        if player["id"] == player_id:
            return float(player["x"]), float(player["y"])
    raise KeyError(player_id)


def analyse(generated: dict) -> dict:
    phase = generated["phase"]
    frame = generated["frames"][phase["decision_index"]]
    goal_x = float(phase["goal_x"])
    actor = phase["actor_id"]
    taken_receiver = phase["receiver_id"]
    ax, ay = _xy(frame, actor)
    ball_x = float(frame["ball"]["x"])
    ball_y = float(frame["ball"]["y"])
    opponents = [
        (float(player["x"]), float(player["y"]))
        for player in frame["players"]
        if player["team"] == "away"
    ]
    teammates = [
        player
        for player in generated["players"]
        if player["team"] == "home" and player["id"] not in {actor, "h1"}
    ]

    shot_pressure = round(pressure_at(ax, ay, opponents), 4)
    shot_xg = round(expected_goals(ax, ay, goal_x, shot_pressure), 4)
    shot_angle = round(goal_angle(ax, ay, goal_x), 4)
    shot_dist = round(((goal_x - ax) ** 2 + (34.0 - ay) ** 2) ** 0.5, 4)
    shot = {
        "id": "shot_h8",
        "kind": "shot",
        "evidence_id": "an_shot",
        "player_id": actor,
        "receiver_id": None,
        "taken": False,
        "xg": shot_xg,
        "completion": None,
        "xg_receipt": None,
        "expected_value": shot_xg,
        "decision_score": shot_xg,
        "pressure": shot_pressure,
        "distance_m": shot_dist,
        "angle_rad": shot_angle,
        "lane_block": None,
        "start": {"x": round(ball_x, 3), "y": round(ball_y, 3)},
        "end": {"x": round(min(PITCH_LENGTH - 0.6, goal_x - 0.6), 3), "y": 34.0},
        "label_text": fmt(shot_xg),
    }

    passes = []
    for mate in teammates:
        rx, ry = _xy(frame, mate["id"])
        # A small lead toward the goal, so the ghost aims where the run is going.
        lead_x = min(PITCH_LENGTH - 2.0, rx + 1.6) if rx > ax else rx
        lead_y = ry
        dist = round(((lead_x - ax) ** 2 + (lead_y - ay) ** 2) ** 0.5, 4)
        lane = round(lane_block(ax, ay, lead_x, lead_y, opponents), 4)
        passer_pressure = shot_pressure
        receipt_pressure = round(pressure_at(lead_x, lead_y, opponents), 4)
        completion = round(pass_completion(dist, lane, passer_pressure), 4)
        xg_receipt = round(expected_goals(lead_x, lead_y, goal_x, receipt_pressure), 4)
        value = round(pass_expected_value(completion, xg_receipt), 4)
        passes.append(
            {
                "id": f"pass_{mate['id']}",
                "kind": "pass",
                "evidence_id": f"an_pass_{mate['id']}",
                "player_id": actor,
                "receiver_id": mate["id"],
                "taken": mate["id"] == taken_receiver,
                "xg": xg_receipt,
                "completion": completion,
                "xg_receipt": xg_receipt,
                "expected_value": value,
                "decision_score": value,
                "pressure": passer_pressure,
                "receipt_pressure": receipt_pressure,
                "distance_m": dist,
                "angle_rad": None,
                "lane_block": lane,
                "start": {"x": round(ball_x, 3), "y": round(ball_y, 3)},
                "end": {"x": round(lead_x, 3), "y": round(lead_y, 3)},
                "label_text": fmt(value),
            }
        )

    evidence: dict[str, dict] = {
        "an_pressure": {
            "id": "an_pressure",
            "player_id": actor,
            "pressure": shot_pressure,
            "pressure_display": fmt(shot_pressure),
        },
        "an_shot": _evidence_from_option(shot),
    }
    for option in passes:
        evidence[option["evidence_id"]] = _evidence_from_option(option)

    options = passes + [shot]
    ranking = sorted(options, key=lambda item: (-item["decision_score"], item["id"]))
    return {
        "decision_event_id": "ev_decision",
        "actor_id": actor,
        "frame_index": phase["decision_index"],
        "shot": shot,
        "passes": passes,
        "ranking": [item["id"] for item in ranking],
        "evidence": evidence,
    }


def _evidence_from_option(option: dict) -> dict:
    record = {
        "id": option["evidence_id"],
        "kind": option["kind"],
        "player_id": option["player_id"],
        "receiver_id": option["receiver_id"],
        "taken": option["taken"],
        "decision_score": option["decision_score"],
        "decision_score_display": fmt(option["decision_score"]),
        "expected_value": option["expected_value"],
        "expected_value_display": fmt(option["expected_value"]),
        "xg": option["xg"],
        "xg_display": fmt(option["xg"]),
        "pressure": option["pressure"],
        "pressure_display": fmt(option["pressure"]),
        "distance_m": option["distance_m"],
        "start_x": option["start"]["x"],
        "start_y": option["start"]["y"],
        "end_x": option["end"]["x"],
        "end_y": option["end"]["y"],
    }
    if option["completion"] is not None:
        record["completion"] = option["completion"]
        record["completion_display"] = fmt(option["completion"])
    if option["xg_receipt"] is not None:
        record["xg_receipt"] = option["xg_receipt"]
        record["xg_receipt_display"] = fmt(option["xg_receipt"])
    if option["lane_block"] is not None:
        record["lane_block"] = option["lane_block"]
        record["lane_block_display"] = fmt(option["lane_block"])
    if option["angle_rad"] is not None:
        record["angle_rad"] = option["angle_rad"]
    return record
