"""MCP server over the replay bundle. Transport is stdio.

    python -m otherpitch.mcp_server --data web/public/data
"""

from __future__ import annotations

import argparse
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from otherpitch import tools

mcp = FastMCP(
    "otherpitch",
    instructions=(
        "Other Pitch is a fictional counterfactual football replay. "
        "Tools return synthetic tracking and model estimates for Harbour City FC "
        "against Northvale Athletic. No real club or player is in this data."
    ),
)


@mcp.tool()
def get_match_state() -> dict:
    """Return the fictional match header, phase, players, and chosen moment."""
    return tools.get_match_state()


@mcp.tool()
def list_events() -> list:
    """List synthetic match events in kickoff order."""
    return tools.list_events()


@mcp.tool()
def get_moment() -> dict:
    """Return the decision moment and the action that was actually played."""
    return tools.get_moment()


@mcp.tool()
def get_alternatives() -> list:
    """Return the two untaken alternatives, a pass and a shot."""
    return tools.get_alternatives()


@mcp.tool()
def get_timeline(mode: str = "casual") -> dict:
    """Return the timed replay for mode casual, analyst, or zh."""
    return tools.get_timeline(mode)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Serve Other Pitch tools over MCP stdio.")
    parser.add_argument("--data", type=Path, default=Path("web/public/data"))
    parser.add_argument("--seed", type=int, default=7, help="Used only when --data has no timeline.")
    args = parser.parse_args(argv)
    timeline_path = args.data / "timeline.json"
    if timeline_path.exists():
        tools.load_directory(args.data)
    else:
        from otherpitch.workflow import run_pipeline

        state = run_pipeline(args.seed, use_llm=False)
        tools.bind(state.timeline, {"qa_rejections": state.rejections, "qa_passed": True, "framework": "runtime"})
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
