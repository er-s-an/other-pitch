"""Build and run the ingest-to-personalize handoff."""

from __future__ import annotations

import asyncio
import os

from otherpitch.agents import (
    AnalystAgent,
    DirectorAgent,
    IngestAgent,
    OverlayAgent,
    PersonalizeAgent,
    QAAgent,
)
from otherpitch.framework import FRAMEWORK, WorkflowBuilder
from otherpitch.llm import provider_name
from otherpitch.state import MatchState

_OFFLINE = {"deterministic", "template", "offline", ""}


def build_workflow(state: MatchState):
    ingest = IngestAgent(state)
    analyst = AnalystAgent(state)
    director = DirectorAgent(state)
    qa = QAAgent(state)
    overlay = OverlayAgent(state)
    personalize = PersonalizeAgent(state)
    return (
        WorkflowBuilder(start_executor=ingest, max_iterations=40, name="other-pitch")
        .add_edge(ingest, analyst)
        .add_edge(analyst, director)
        .add_edge(director, qa)
        .add_edge(qa, analyst, condition=lambda message: message.intent == "qa_reject")
        .add_edge(qa, overlay, condition=lambda message: message.intent == "qa_pass")
        .add_edge(overlay, personalize)
        .build()
    )


def run_pipeline(seed: int, *, use_llm: bool | None = None) -> MatchState:
    """Run one seeded match through every agent. Offline unless use_llm is set."""
    if use_llm is None:
        use_llm = provider_name() not in _OFFLINE
    state = MatchState(seed=int(seed), use_llm=use_llm)
    workflow = build_workflow(state)
    asyncio.run(workflow.run(str(seed)))
    if not state.qa_passed or state.timeline is None or state.modes is None:
        raise RuntimeError(f"pipeline did not finish on {FRAMEWORK}")
    if not any(item["intent"] == "qa_reject" for item in state.trace):
        raise RuntimeError("pipeline produced no QA rejection")
    if not any(item["intent"] == "qa_pass" for item in state.trace):
        raise RuntimeError("pipeline produced no QA pass")
    return state


def trace_document(state: MatchState) -> dict:
    return {
        "seed": state.seed,
        "framework": FRAMEWORK,
        "llm_requested": provider_name() if state.use_llm else "deterministic",
        "llm_notes": list(state.llm_notes),
        "qa_rejections": state.rejections,
        "qa_passed": state.qa_passed,
        "fictional": True,
        "messages": state.trace,
    }


def force_offline() -> None:
    os.environ["OTHERPITCH_LLM"] = "deterministic"
