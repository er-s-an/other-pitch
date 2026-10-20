"""Template narration. Decimals are copied from evidence display strings."""

from __future__ import annotations

from otherpitch.qa import collect_numbers


def choose_decoy(evidence: dict, cited: list[str]) -> str:
    """A two-decimal figure that sits away from every cited number."""
    allowed = collect_numbers({key: evidence[key] for key in cited if key in evidence})
    for whole in (0, 4, 11, 19, 27, 41, 63, 77, 91):
        for hundredths in range(1, 100):
            candidate = whole + hundredths / 100.0
            if all(abs(candidate - number) > 0.05 for number in allowed):
                return f"{candidate:.2f}"
    return "77.77"


def _by_id(players: list[dict]) -> dict[str, dict]:
    return {player["id"]: player for player in players}


def _last(name: str) -> str:
    parts = name.split()
    return parts[-1] if parts else name


def _lane(option: dict) -> str:
    y = float(option["end"]["y"])
    if y < 18.0 or y > 50.0:
        return "wide"
    return "inside"


def _lane_word(option: dict) -> str:
    return "Wide" if _lane(option) == "wide" else "Inside"


def clean_narratives(moment: dict, players: list[dict], evidence: dict) -> dict[str, dict]:
    names = _by_id(players)
    actor = names[moment["actor_id"]]
    taken = moment["taken"]
    pass_alt = next(item for item in moment["alternatives"] if item["kind"] == "pass")
    shot_alt = next(item for item in moment["alternatives"] if item["kind"] == "shot")
    taken_player = names[taken["receiver_id"]]
    alt_player = names[pass_alt["receiver_id"]]
    taken_ev = evidence[taken["evidence_id"]]
    alt_ev = evidence[pass_alt["evidence_id"]]
    shot_ev = evidence[shot_alt["evidence_id"]]
    actor_last = _last(actor["name"])
    taken_last = _last(taken_player["name"])
    alt_last = _last(alt_player["name"])

    def label_pass(option: dict, who: dict) -> dict[str, str]:
        word = _lane_word(option)
        record = evidence[option["evidence_id"]]
        return {
            "casual": f"{word} to {_last(who['name'])}",
            "analyst": (
                f"Pass to {_last(who['name'])}, value {record['decision_score_display']}"
            ),
            "zh": f"{'边路' if word == 'Wide' else '内切'}传给{who['zh']}，期望值 {record['decision_score_display']}",
        }

    taken_labels = label_pass(taken, taken_player)
    alt_labels = label_pass(pass_alt, alt_player)
    shot_labels = {
        "casual": "Strike it",
        "analyst": f"Shot, xG {shot_ev['xg_display']}",
        "zh": f"直接射门，预期进球 {shot_ev['xg_display']}",
    }
    option_ids = {
        taken["id"]: taken_labels,
        pass_alt["id"]: alt_labels,
        shot_alt["id"]: shot_labels,
    }
    taken_lane = _lane(taken)
    alt_lane = _lane(pass_alt)

    casual = {
        "caption": (
            f"{actor_last} has the ball outside the box. "
            f"The pass that happens goes {taken_lane} to {taken_last}. "
            f"The {alt_lane} ball to {alt_last} is not played."
        ),
        "reveal": "The played pass is solid. The other two are ghosts.",
        "quiz_prompt": "Guess the pass",
        "verdict_right": "That is the pass that was played.",
        "verdict_wrong": "A different action was played.",
        "options": {key: value["casual"] for key, value in option_ids.items()},
    }
    analyst = {
        "caption": (
            f"Shot xG {shot_ev['xg_display']} under pressure {shot_ev['pressure_display']}. "
            f"Pass to {alt_last} expected value {alt_ev['decision_score_display']} "
            f"(completion {alt_ev['completion_display']}, receipt xG {alt_ev['xg_display']}). "
            f"The pass played, to {taken_last}, expected value {taken_ev['decision_score_display']}."
        ),
        "reveal": (
            f"Selected action value {taken_ev['decision_score_display']}. "
            f"Best untaken pass value {alt_ev['decision_score_display']}."
        ),
        "quiz_prompt": f"Which action did {actor_last} select?",
        "verdict_right": "That action matches the event.",
        "verdict_wrong": "The event is a different action.",
        "options": {key: value["analyst"] for key, value in option_ids.items()},
    }
    zh = {
        "caption": (
            f"{actor['zh']}在禁区前拿球，实际把球{('边路' if taken_lane == 'wide' else '内切')}传给了{taken_player['zh']}，"
            f"期望值 {taken_ev['decision_score_display']}。"
            f"传给{alt_player['zh']}的另一条路线期望值 {alt_ev['decision_score_display']}，没有被踢出。"
        ),
        "reveal": "实线是踢出的传球。另外两条是幽灵轨迹。",
        "quiz_prompt": "猜这脚球",
        "verdict_right": "这就是踢出的传球。",
        "verdict_wrong": "踢出的是另一脚。",
        "options": {key: value["zh"] for key, value in option_ids.items()},
    }
    return {"casual": casual, "analyst": analyst, "zh": zh}


def with_draft_decoy(narratives: dict[str, dict], decoy: str) -> dict[str, dict]:
    drafted: dict[str, dict] = {}
    for mode, block in narratives.items():
        copied = {key: value for key, value in block.items()}
        if mode == "zh":
            copied["caption"] = block["caption"].rstrip() + f" 草稿数字 {decoy}。"
        else:
            copied["caption"] = block["caption"].rstrip() + f" Draft figure {decoy}."
        drafted[mode] = copied
    return drafted
