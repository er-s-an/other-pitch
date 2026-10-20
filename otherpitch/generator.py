"""Seeded fictional match events and a 25 Hz tracking window.

Teams, players and the score are invented. The same seed always rebuilds
the same events and the same frames. Tracking covers the thirteen seconds
around one scripted decision, at exactly 25 frames per second.
"""

from __future__ import annotations

import random

from otherpitch.analytics import PITCH_LENGTH, PITCH_WIDTH, clamp

HZ = 25
CLIP_SECONDS = 13.0
DECISION_T = 8.0
FRAME_COUNT = int(CLIP_SECONDS * HZ)  # 325 frames, t = 0 .. 12.96
DECISION_INDEX = int(DECISION_T * HZ)  # 200
MATCH_DECISION_T = 67 * 60  # 4020 seconds, the 67th minute
CLIP_START = MATCH_DECISION_T - DECISION_T

HOME = {
    "id": "harbour",
    "name": "Harbour City FC",
    "short": "HFC",
    "color": "#1F7A8C",
}
AWAY = {
    "id": "northvale",
    "name": "Northvale Athletic",
    "short": "NVA",
    "color": "#E4E0D6",
}

# id, name, role, number, Chinese short name. All fictional.
HOME_XI = [
    ("h1", "Mara Ellison", "GK", 1, "埃里森"),
    ("h2", "Jonah Peck", "RB", 2, "佩克"),
    ("h3", "Nia Okonkwo", "LB", 3, "奥孔科"),
    ("h4", "Tomasz Hale", "CB", 4, "黑尔"),
    ("h5", "Ivo Maren", "CB", 5, "马伦"),
    ("h6", "Cleo Hart", "DM", 6, "哈特"),
    ("h7", "Remy Voss", "AM", 7, "沃斯"),
    ("h8", "Idris Calder", "CM", 8, "卡尔德"),
    ("h9", "Sable Quinn", "ST", 9, "奎因"),
    ("h10", "Leif Navarro", "RW", 10, "纳瓦罗"),
    ("h11", "Hanae Solis", "LW", 11, "索利斯"),
]
AWAY_XI = [
    ("a1", "Peder Holm", "GK", 1, "霍尔姆"),
    ("a2", "Cassian Doyle", "RB", 2, "多伊尔"),
    ("a3", "Ruth Abebe", "LB", 3, "阿贝贝"),
    ("a4", "Malik Ferenc", "CB", 4, "费伦茨"),
    ("a5", "Owen Brant", "CB", 5, "布兰特"),
    ("a6", "Jules Okada", "DM", 6, "冈田"),
    ("a7", "Nina Pell", "CM", 7, "佩尔"),
    ("a8", "Hugo Marte", "CM", 8, "马尔特"),
    ("a9", "Soren Blake", "ST", 9, "布莱克"),
    ("a10", "Farah Lind", "RW", 10, "林德"),
    ("a11", "Theo Quill", "LW", 11, "奎尔"),
]

# Positions at clip t = 0, t = 8 (the decision) and t = 13. Metres.
# Harbour attack toward x = 105. Calder (h8) carries; Quinn (h9) runs in
# behind; Okonkwo (h3) holds the safe wide lane; Okada (a6) closes the ball.
MOTION: dict[str, tuple[float, float, float, float, float, float]] = {
    "h1": (8, 34, 8, 34, 9, 34),
    "h2": (56, 16, 62, 18, 64, 20),
    "h3": (58, 10, 60, 8, 62, 9),
    "h4": (44, 28, 50, 28, 52, 29),
    "h5": (46, 42, 52, 42, 54, 41),
    "h6": (52, 34, 60, 34, 62, 35),
    "h7": (68, 54, 80, 58, 82, 58),
    "h8": (62, 32, 73, 33, 72, 34),
    "h9": (80, 34, 93, 35, 97, 35),
    "h10": (74, 62, 86, 63, 88, 62),
    "h11": (66, 8, 74, 6, 76, 7),
    "a1": (102, 34, 101, 34, 100, 34),
    "a2": (84, 58, 88, 56, 90, 54),
    "a3": (82, 18, 86, 16, 88, 16),
    "a4": (94, 26, 96, 27, 97, 28),
    "a5": (95, 44, 97, 42, 98, 41),
    "a6": (80, 42, 71, 39, 70, 38),
    "a7": (78, 50, 84, 48, 85, 47),
    "a8": (68, 24, 72, 26, 74, 27),
    "a9": (40, 34, 38, 36, 36, 36),
    "a10": (58, 60, 56, 62, 54, 62),
    "a11": (54, 12, 50, 14, 48, 15),
}

ACTOR_ID = "h8"
TAKEN_RECEIVER = "h3"
HOME_OUTFIELD = [row[0] for row in HOME_XI if row[0] != "h1"]
AWAY_OUTFIELD = [row[0] for row in AWAY_XI if row[0] != "a1"]


def _players() -> list[dict]:
    rows = []
    for pid, name, role, number, zh in HOME_XI:
        rows.append(
            {"id": pid, "name": name, "team": "home", "role": role, "number": number, "zh": zh}
        )
    for pid, name, role, number, zh in AWAY_XI:
        rows.append(
            {"id": pid, "name": name, "team": "away", "role": role, "number": number, "zh": zh}
        )
    return rows


def _smooth(a: float, b: float, u: float) -> float:
    u = u * u * (3.0 - 2.0 * u)
    return a + (b - a) * u


def _offsets(rng: random.Random) -> dict[str, tuple[float, float]]:
    offsets = {}
    for pid in MOTION:
        offsets[pid] = ((rng.random() - 0.5) * 0.7, (rng.random() - 0.5) * 0.7)
    return offsets


def _at(pid: str, t: float, offsets: dict[str, tuple[float, float]]) -> tuple[float, float]:
    x0, y0, x1, y1, x2, y2 = MOTION[pid]
    ox, oy = offsets[pid]
    if t <= DECISION_T:
        u = t / DECISION_T
        x, y = _smooth(x0, x1, u), _smooth(y0, y1, u)
    else:
        u = min(1.0, (t - DECISION_T) / (CLIP_SECONDS - DECISION_T))
        x, y = _smooth(x1, x2, u), _smooth(y1, y2, u)
    return (
        round(clamp(x + ox, 1.5, PITCH_LENGTH - 1.5), 3),
        round(clamp(y + oy, 1.5, PITCH_WIDTH - 1.5), 3),
    )


def _ball(t: float, offsets: dict[str, tuple[float, float]]) -> tuple[float, float]:
    arrival = 9.8
    bx, by = _at(ACTOR_ID, min(t, DECISION_T), offsets)
    if t <= DECISION_T:
        return round(bx + 0.45, 3), round(by + 0.2, 3)
    end = _at(TAKEN_RECEIVER, arrival, offsets)
    if t >= arrival:
        rx, ry = _at(TAKEN_RECEIVER, t, offsets)
        return round(rx + 0.35, 3), round(ry + 0.15, 3)
    u = (t - DECISION_T) / (arrival - DECISION_T)
    x0, y0 = bx + 0.45, by + 0.2
    xe, ye = end
    mx, my = (x0 + xe) / 2.0, (y0 + ye) / 2.0
    dx, dy = xe - x0, ye - y0
    cx, cy = mx - dy * 0.12, my + dx * 0.12
    omu = 1.0 - u
    x = omu * omu * x0 + 2 * omu * u * cx + u * u * xe
    y = omu * omu * y0 + 2 * omu * u * cy + u * u * ye
    return round(x, 3), round(y, 3)


def _frames(offsets: dict[str, tuple[float, float]]) -> list[dict]:
    frames = []
    roster = _players()
    for index in range(FRAME_COUNT):
        t = index / HZ
        players = []
        for player in roster:
            x, y = _at(player["id"], t, offsets)
            players.append(
                {
                    "id": player["id"],
                    "team": player["team"],
                    "number": player["number"],
                    "x": x,
                    "y": y,
                }
            )
        ball_x, ball_y = _ball(t, offsets)
        frames.append(
            {
                "index": index,
                "t": round(t, 6),
                "match_t": round(CLIP_START + t, 6),
                "source": "synthetic_tracking",
                "ball": {"x": ball_x, "y": ball_y},
                "players": players,
            }
        )
    return frames


def _event(
    event_id: str,
    match_t: float,
    kind: str,
    team: str,
    player_id: str,
    x: float,
    y: float,
    outcome: str,
    end_x: float | None = None,
    end_y: float | None = None,
    receiver_id: str | None = None,
) -> dict:
    return {
        "id": event_id,
        "match_t": round(match_t, 3),
        "minute": int(match_t // 60),
        "type": kind,
        "team": team,
        "player_id": player_id,
        "x": round(x, 3),
        "y": round(y, 3),
        "end_x": None if end_x is None else round(end_x, 3),
        "end_y": None if end_y is None else round(end_y, 3),
        "outcome": outcome,
        "receiver_id": receiver_id,
    }


def _filler(rng: random.Random) -> list[dict]:
    events = []
    teams = {"home": HOME_OUTFIELD, "away": AWAY_OUTFIELD}
    team = "home"
    t = 18.0
    serial = 1
    while t < 5480 and serial <= 72:
        t += 18.0 + rng.random() * 28.0
        if 4006.0 <= t <= 4032.0:
            continue
        ids = teams[team]
        passer = ids[int(rng.random() * len(ids))]
        receiver = ids[int(rng.random() * len(ids))]
        if receiver == passer:
            receiver = ids[(ids.index(passer) + 1) % len(ids)]
        x = round(12 + rng.random() * 78, 3)
        y = round(6 + rng.random() * 56, 3)
        end_x = round(clamp(x + (rng.random() - 0.4) * 16, 4, 100), 3)
        end_y = round(clamp(y + (rng.random() - 0.5) * 14, 3, 65), 3)
        kind = "pass" if rng.random() > 0.08 else "carry"
        events.append(
            _event(
                f"ev_{serial:04d}",
                t,
                kind,
                team,
                passer,
                x,
                y,
                "complete" if kind == "carry" or rng.random() > 0.18 else "incomplete",
                end_x,
                end_y,
                None if kind == "carry" else receiver,
            )
        )
        if rng.random() < 0.42:
            team = "away" if team == "home" else "home"
        serial += 1
    return events


def _scripted(offsets: dict[str, tuple[float, float]]) -> list[dict]:
    calder = _at(ACTOR_ID, DECISION_T, offsets)
    nia = _at(TAKEN_RECEIVER, 9.8, offsets)
    hart = _at("h6", 2.4, offsets)
    return [
        _event("ev_goal_home", 1322.0, "shot", "home", "h9", 96.2, 34.4, "goal", 105.0, 34.1),
        _event("ev_goal_away", 2468.0, "shot", "away", "a9", 12.4, 33.2, "goal", 0.0, 34.0),
        _event(
            "ev_receive",
            CLIP_START + 2.4,
            "pass",
            "home",
            "h6",
            hart[0],
            hart[1],
            "complete",
            calder[0] - 4,
            calder[1],
            ACTOR_ID,
        ),
        _event(
            "ev_decision",
            MATCH_DECISION_T,
            "pass",
            "home",
            ACTOR_ID,
            calder[0],
            calder[1],
            "complete",
            nia[0],
            nia[1],
            TAKEN_RECEIVER,
        ),
    ]


def generate(seed: int) -> dict:
    rng = random.Random(seed)
    offsets = _offsets(rng)
    events = _scripted(offsets) + _filler(rng)
    events.sort(key=lambda item: (item["match_t"], item["id"]))
    frames = _frames(offsets)
    return {
        "match": {
            "id": f"synthetic-seed-{seed}",
            "fictional": True,
            "seed": seed,
            "competition": "Harbour Cup",
            "venue": "East Quay Ground",
            "minute": 67,
            "clock": "67:00",
            "home": dict(HOME),
            "away": dict(AWAY),
            "score": {"home": 1, "away": 1},
            "note": "Fictional clubs, players and events. Tracking is synthetic.",
        },
        "players": _players(),
        "events": events,
        "frames": frames,
        "phase": {
            "hz": HZ,
            "frame_count": FRAME_COUNT,
            "decision_index": DECISION_INDEX,
            "decision_t": DECISION_T,
            "decision_match_t": MATCH_DECISION_T,
            "clip_start": CLIP_START,
            "actor_id": ACTOR_ID,
            "receiver_id": TAKEN_RECEIVER,
            "goal_x": PITCH_LENGTH,
            "goal_y": 34.0,
            "pitch": {"length": PITCH_LENGTH, "width": PITCH_WIDTH},
        },
    }
