"""Export scenario definitions and Python engine outputs for the browser engine and its parity test.

    .venv/bin/python -m otherpitch.v2.export_fixtures
"""

from __future__ import annotations

import json
from pathlib import Path

from otherpitch.v2 import simulation as S
from otherpitch.v2.scenarios import HELDOUT, PLAYABLE, get_scenario, variants


def main() -> None:
    scenes = {sid: get_scenario(sid) for sid in PLAYABLE + HELDOUT}
    params = {k: getattr(S, k) for k in ("DT", "BALL_SPEED", "RUN_SPEED", "DEF_SPEED", "DEF_REACTION_S", "CONTROL_S",
                                          "SHOT_WINDUP_S", "CARRY_SPEED", "SHOOT_RANGE_M", "RECYCLE_PRESSURE")}
    Path("web/src/data").mkdir(parents=True, exist_ok=True)
    Path("web/src/data/scenarios.json").write_text(json.dumps({"params": params, "scenes": scenes}, indent=1))
    fixture = []
    for sid, scn in scenes.items():
        for v in variants(sid):
            snap = S.make_snapshot(scn, v)
            for b in S.simulate_all(snap):
                fr = b["trajectory"]["frames"]
                fixture.append({"scene": sid, "variant": v, "action_id": b["action_id"], "metrics": b["metrics"],
                                "leaves": b["outcome_tree"]["leaves"], "inputs": b["inputs"], "leaf": b["trajectory"]["leaf"],
                                "frame_count": len(fr), "last_ball": fr[-1]["ball"], "last_t": fr[-1]["t"]})
    Path("web/tests").mkdir(parents=True, exist_ok=True)
    Path("web/tests/parity-fixture.json").write_text(json.dumps(fixture, indent=1))
    print(len(fixture), "branches exported")


if __name__ == "__main__":
    main()
