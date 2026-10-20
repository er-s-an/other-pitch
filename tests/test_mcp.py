"""MCP tool functions, plus registration on the FastMCP server."""

import asyncio

from otherpitch.mcp_server import mcp
from otherpitch.timeline import MODES
from otherpitch.tools import (
    bind,
    get_alternatives,
    get_match_state,
    get_moment,
    get_timeline,
    list_events,
)
from otherpitch.workflow import run_pipeline


def _bind():
    state = run_pipeline(7, use_llm=False)
    bind(state.timeline, {"qa_rejections": state.rejections, "qa_passed": True, "framework": "test"})
    return state


def test_tool_functions_read_the_bundle():
    state = _bind()
    header = get_match_state()
    assert header["match"]["home"]["name"] == "Harbour City FC"
    assert header["fictional"] is True
    assert header["qa"]["passed"] is True
    events = list_events()
    assert any(event["id"] == "ev_decision" for event in events)
    moment = get_moment()
    assert moment["moment"]["event_id"] == "ev_decision"
    assert moment["taken"]["taken"] is True
    alternatives = get_alternatives()
    assert len(alternatives) == 2
    assert {item["kind"] for item in alternatives} == {"pass", "shot"}
    assert all(item["taken"] is False for item in alternatives)
    for mode in MODES:
        shaped = get_timeline(mode)
        assert shaped["mode"] == mode
        assert len(shaped["frames"]) == len(state.timeline["frames"])
        assert shaped["quiz"]["options"]
    zh = get_timeline("中文")
    assert zh["mode"] == "zh"


def test_unknown_mode_raises():
    _bind()
    try:
        get_timeline("klingon")
    except ValueError as exc:
        assert "klingon" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_server_registers_the_five_tools():
    tools = asyncio.run(mcp.list_tools())
    names = sorted(tool.name for tool in tools)
    assert names == [
        "get_alternatives",
        "get_match_state",
        "get_moment",
        "get_timeline",
        "list_events",
    ]
