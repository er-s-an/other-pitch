"""The seeded match is stable, 25 Hz, and fictional."""

import json

from otherpitch.generator import AWAY, FRAME_COUNT, HOME, HZ, generate

BANNED = (
    "arsenal",
    "chelsea",
    "liverpool",
    "manchester",
    "tottenham",
    "premier league",
    "haaland",
    "salah",
    "kane",
    "saka",
)


def test_same_seed_is_byte_identical():
    first = json.dumps(generate(7), sort_keys=True)
    second = json.dumps(generate(7), sort_keys=True)
    assert first == second


def test_seeds_diverge():
    assert generate(7)["frames"][10] != generate(8)["frames"][10]


def test_tracking_is_25hz_and_full_sided():
    match = generate(7)
    frames = match["frames"]
    assert len(frames) == FRAME_COUNT == 325
    assert match["phase"]["hz"] == HZ == 25
    assert round(frames[1]["t"] - frames[0]["t"], 6) == round(1 / 25, 6)
    assert frames[0]["source"] == "synthetic_tracking"
    assert len(frames[0]["players"]) == 22
    assert match["phase"]["decision_index"] == 200
    assert frames[200]["t"] == 8.0


def test_clubs_and_players_are_fictional():
    match = generate(7)
    blob = json.dumps(match["match"]).lower() + json.dumps(match["players"]).lower()
    assert match["match"]["home"]["name"] == HOME["name"] == "Harbour City FC"
    assert match["match"]["away"]["name"] == AWAY["name"] == "Northvale Athletic"
    assert match["match"]["fictional"] is True
    for word in BANNED:
        assert word not in blob
    assert any(event["id"] == "ev_decision" for event in match["events"])
