"""The CLI writes a timeline, a trace, and one file per mode."""

import json

from otherpitch.build import main


def test_cli_writes_the_bundle(tmp_path):
    code = main(["--seed", "7", "--out", str(tmp_path), "--no-llm"])
    assert code == 0
    timeline = json.loads((tmp_path / "timeline.json").read_text(encoding="utf-8"))
    trace = json.loads((tmp_path / "trace.json").read_text(encoding="utf-8"))
    assert timeline["fictional"] is True
    assert timeline["match"]["seed"] == 7
    assert any(item["intent"] == "qa_reject" for item in trace["messages"])
    for mode in ("casual", "analyst", "zh"):
        shaped = json.loads((tmp_path / f"{mode}.json").read_text(encoding="utf-8"))
        assert shaped["mode"] == mode
        assert shaped["quiz"]["correct_id"] == timeline["quiz"]["correct_id"]
