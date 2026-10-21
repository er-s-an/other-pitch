"""Fictional, hand-tuned decision snapshots. Teams, players and scores are invented.

Each scenario fixes the state at the decision instant t0. Velocities describe the
run each player is already making (m/s); the lead-in is extrapolated backwards from them.
No scenario names a best action: every metric is computed by simulation.py.
"""

from __future__ import annotations

import copy

HOME = {"id": "harbour", "name": "Harbour City FC", "short": "HFC", "color": "#2BB3C0"}
AWAY = {"id": "northvale", "name": "Northvale Athletic", "short": "NVA", "color": "#F2EEE3"}


def P(pid, team, num, name, role, x, y, vx=0.0, vy=0.0):
    return {"id": pid, "team": team, "number": num, "name": name, "role": role,
            "x": float(x), "y": float(y), "vx": float(vx), "vy": float(vy)}


_SCENES: dict[str, dict] = {
    "central-lane": {
        "scenario_id": "central-lane",
        "scenario_version": "1.0",
        "title": "You missed the middle",
        "brief": "Calder carries at the top of the final third. Quinn is starting a run between the centre-backs.",
        "tactic": "Spot the central run before the lane closes.",
        "clock": "67:00", "score": {"home": 1, "away": 1},
        "carrier_id": "h8",
        "players": [
            P("h8", "home", 8, "Idris Calder", "CM", 71, 33, 3.0, 0.0),
            P("h9", "home", 9, "Sable Quinn", "ST", 87, 37, 4.5, -0.3),
            P("h3", "home", 3, "Nia Okonkwo", "LB", 79, 9, 3.0, 0.0),
            P("h10", "home", 10, "Leif Navarro", "RW", 84, 58, 2.5, -1.0),
            P("h6", "home", 6, "Cleo Hart", "DM", 60, 36, 2.0, 0.0),
            P("a1", "away", 1, "Peder Holm", "GK", 102, 34),
            P("a4", "away", 4, "Malik Ferenc", "CB", 90, 27, 0.5, 0.0),
            P("a5", "away", 5, "Owen Brant", "CB", 91, 46, 0.5, 0.0),
            P("a6", "away", 6, "Jules Okada", "DM", 78, 41, -1.0, -0.5),
            P("a2", "away", 2, "Cassian Doyle", "RB", 86, 14, 1.0, 0.0),
            P("a3", "away", 3, "Ruth Abebe", "LB", 88, 58, 1.0, 0.0),
            P("a7", "away", 7, "Nina Pell", "CM", 70, 24, 1.5, 0.5),
        ],
        "key_defender_ids": ["a6"],
        "actions": [
            {"action_id": "pass_wide", "type": "pass", "actor_id": "h8", "receiver_id": "h3",
             "target": [83, 9], "label": "Wide to Okonkwo"},
            {"action_id": "pass_central", "type": "pass", "actor_id": "h8", "receiver_id": "h9",
             "target": [96, 36], "label": "Through ball to Quinn"},
            {"action_id": "shoot", "type": "shot", "actor_id": "h8", "receiver_id": None,
             "target": [105, 34], "label": "Shoot from range"},
        ],
        "recorded_action_id": "pass_wide",
        "interventions": [
            {"intervention_id": "defender_closes_lane", "variant_id": "lane_closed",
             "label": "Okada steps into the passing lane",
             "subject_id": "a6", "field": "position",
             "after": [81, 34.5],
             "allowed_range": "preset legal positions only: base [78, 41] or lane [81, 34.5]"},
        ],
        "explanation_hints": {
            "lane_blocked": "Okada has stepped onto the passing line. Quinn is still free, but the ball is harder to get through.",
            "receiver_space": "Quinn's run splits the centre-backs before anyone closes the lane.",
        },
    },
    "open-not-safe": {
        "scenario_id": "open-not-safe",
        "scenario_version": "1.0",
        "title": "Open is not the same as safe",
        "brief": "Solis is wide on the left. Navarro is unmarked at the far post.",
        "tactic": "The space is near the receiver. The danger is on the way there.",
        "clock": "38:20", "score": {"home": 0, "away": 0},
        "carrier_id": "h11",
        "players": [
            P("h11", "home", 11, "Hanae Solis", "LW", 84, 7, 2.5, 0.5),
            P("h10", "home", 10, "Leif Navarro", "RW", 94, 52, 1.0, -1.0),
            P("h7", "home", 7, "Remy Voss", "AM", 82, 22, 2.5, 0.5),
            P("h9", "home", 9, "Sable Quinn", "ST", 93, 33, 1.0, 0.0),
            P("h3", "home", 3, "Nia Okonkwo", "LB", 72, 10, 2.0, 0.0),
            P("a1", "away", 1, "Peder Holm", "GK", 101, 30),
            P("a5", "away", 5, "Owen Brant", "CB", 95, 37, 0.0, 0.5),
            P("a4", "away", 4, "Malik Ferenc", "CB", 93, 29, 0.0, 0.0),
            P("a2", "away", 2, "Cassian Doyle", "RB", 90, 15, -0.5, -0.5),
            P("a6", "away", 6, "Jules Okada", "DM", 85, 26, 0.0, 0.0),
            P("a3", "away", 3, "Ruth Abebe", "LB", 100, 62, 0.0, -0.5),
            P("a8", "away", 8, "Hugo Marte", "CM", 78, 30, 0.5, 0.0),
        ],
        "key_defender_ids": ["a5", "a6"],
        "actions": [
            {"action_id": "cross_far", "type": "pass", "actor_id": "h11", "receiver_id": "h10",
             "target": [96, 49], "label": "Cross to Navarro"},
            {"action_id": "short_support", "type": "pass", "actor_id": "h11", "receiver_id": "h7",
             "target": [85, 21], "label": "Short to Voss"},
            {"action_id": "shoot", "type": "shot", "actor_id": "h11", "receiver_id": None,
             "target": [105, 34], "label": "Shoot from the angle"},
        ],
        "recorded_action_id": "cross_far",
        "interventions": [],
        "explanation_hints": {
            "lane_blocked": "Navarro is free, but the ball has to travel through Brant's zone to reach him.",
            "receiver_space": "Voss is close, and the short pass gives the next action time.",
        },
    },
    "close-call": {
        "scenario_id": "close-call",
        "scenario_version": "1.0",
        "title": "A good choice can still fail",
        "brief": "Voss is on the edge of the box. Shoot now, or square it to Quinn?",
        "tactic": "Two routes are close. One is direct, one keeps the ball longer.",
        "clock": "84:10", "score": {"home": 1, "away": 2},
        "carrier_id": "h7",
        "players": [
            P("h7", "home", 7, "Remy Voss", "AM", 86, 27, 2.5, 0.5),
            P("h9", "home", 9, "Sable Quinn", "ST", 89, 40, 1.5, -0.5),
            P("h6", "home", 6, "Cleo Hart", "DM", 73, 32, 1.0, 0.0),
            P("h10", "home", 10, "Leif Navarro", "RW", 85, 56, 2.0, -0.5),
            P("h11", "home", 11, "Hanae Solis", "LW", 84, 10, 2.0, 0.0),
            P("a1", "away", 1, "Peder Holm", "GK", 102, 33),
            P("a4", "away", 4, "Malik Ferenc", "CB", 93, 30, 0.0, 0.0),
            P("a5", "away", 5, "Owen Brant", "CB", 95, 40, -0.5, 0.0),
            P("a6", "away", 6, "Jules Okada", "DM", 89, 26, -1.0, 0.0),
            P("a8", "away", 8, "Hugo Marte", "CM", 83, 35, 0.5, 0.0),
            P("a2", "away", 2, "Cassian Doyle", "RB", 90, 14, 0.0, 0.0),
            P("a3", "away", 3, "Ruth Abebe", "LB", 92, 54, 0.0, 0.0),
        ],
        "key_defender_ids": ["a6", "a8"],
        "actions": [
            {"action_id": "shoot", "type": "shot", "actor_id": "h7", "receiver_id": None,
             "target": [105, 34], "label": "Shoot now"},
            {"action_id": "lay_off", "type": "pass", "actor_id": "h7", "receiver_id": "h9",
             "target": [91, 39], "label": "Square to Quinn"},
            {"action_id": "recycle", "type": "pass", "actor_id": "h7", "receiver_id": "h6",
             "target": [75, 32], "label": "Back to Hart"},
        ],
        "recorded_action_id": "shoot",
        "interventions": [],
        "explanation_hints": {
            "close_tradeoff": "Both routes give a similar chance. The shot is direct; the square pass carries more risk of losing the ball first.",
        },
    },
    # Held-out input: same schema, new legal parameters, no hand-written explanation.
    "heldout-01": {
        "scenario_id": "heldout-01",
        "scenario_version": "1.0",
        "title": "Held-out input",
        "brief": "New legal parameters run through the same pipeline. No explanation was written for it.",
        "tactic": "Validation only.",
        "clock": "52:40", "score": {"home": 0, "away": 1},
        "carrier_id": "h10",
        "players": [
            P("h10", "home", 10, "Leif Navarro", "RW", 76, 55, 3.0, -0.5),
            P("h9", "home", 9, "Sable Quinn", "ST", 90, 41, 3.5, -0.5),
            P("h7", "home", 7, "Remy Voss", "AM", 80, 40, 1.5, 0.0),
            P("h2", "home", 2, "Jonah Peck", "RB", 68, 62, 2.0, 0.0),
            P("a1", "away", 1, "Peder Holm", "GK", 102, 35),
            P("a4", "away", 4, "Malik Ferenc", "CB", 92, 32, 0.0, 0.0),
            P("a5", "away", 5, "Owen Brant", "CB", 91, 47, 0.0, 0.0),
            P("a3", "away", 3, "Ruth Abebe", "LB", 82, 57, -0.5, 0.0),
            P("a6", "away", 6, "Jules Okada", "DM", 83, 44, 0.0, 0.0),
        ],
        "key_defender_ids": ["a6", "a3"],
        "actions": [
            {"action_id": "pass_inside", "type": "pass", "actor_id": "h10", "receiver_id": "h9",
             "target": [95, 40], "label": "Inside to Quinn"},
            {"action_id": "pass_short", "type": "pass", "actor_id": "h10", "receiver_id": "h7",
             "target": [82, 41], "label": "Short to Voss"},
            {"action_id": "shoot", "type": "shot", "actor_id": "h10", "receiver_id": None,
             "target": [105, 34], "label": "Shoot"},
        ],
        "recorded_action_id": "pass_short",
        "interventions": [],
        "explanation_hints": {},
        "heldout": True,
    },
}

PLAYABLE = ["central-lane", "open-not-safe", "close-call"]
HELDOUT = ["heldout-01"]


def scenario_ids() -> list[str]:
    return PLAYABLE + HELDOUT


def get_scenario(scenario_id: str) -> dict:
    if scenario_id not in _SCENES:
        raise KeyError(f"unknown scenario {scenario_id!r}")
    return copy.deepcopy(_SCENES[scenario_id])


def variants(scenario_id: str) -> list[str]:
    return ["base"] + [i["variant_id"] for i in _SCENES[scenario_id]["interventions"]]
