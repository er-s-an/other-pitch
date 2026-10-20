"""Six executors. Handoffs are envelopes on a shared MatchState."""

from __future__ import annotations

import json
import random
from typing import Any, Never

from otherpitch.analyst import analyse
from otherpitch.framework import Executor, WorkflowContext, handler
from otherpitch.generator import generate
from otherpitch.llm import complete, provider_name
from otherpitch.narrate import choose_decoy, clean_narratives, with_draft_decoy
from otherpitch.qa import review_claims
from otherpitch.state import Envelope, MatchState
from otherpitch.timeline import MODES, build_timeline, shape_mode, validate_timeline

_LLM_SYSTEM = (
    "You write short fictional football commentary for a synthetic match. "
    "Reply with a JSON object whose keys are exactly casual, analyst and zh. "
    "Each value is one or two sentences. "
    "Use a decimal only if it appears in the allowed list. Invent no clubs, players or numbers. "
    "zh is Simplified Chinese."
)


def evidence_book(generated: dict, analysis: dict) -> dict[str, Any]:
    book: dict[str, Any] = {}
    for event in generated["events"]:
        book[event["id"]] = event
    book.update(analysis["evidence"])
    frame = generated["frames"][analysis["frame_index"]]
    book["tr_decision"] = {
        "id": "tr_decision",
        "source": "synthetic_tracking",
        "frame_index": analysis["frame_index"],
        "t": frame["t"],
        "ball_x": frame["ball"]["x"],
        "ball_y": frame["ball"]["y"],
    }
    return book


def _captions(narratives: dict[str, dict]) -> dict[str, str]:
    return {mode: block["caption"] for mode, block in narratives.items()}


def _parse_modes(raw: str) -> dict[str, str] | None:
    text = raw.strip()
    if text.startswith("```"):
        lines = [line for line in text.splitlines() if not line.strip().startswith("```")]
        text = "\n".join(lines).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    if not isinstance(data, dict):
        return None
    parsed: dict[str, str] = {}
    for key in ("casual", "analyst", "zh"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            parsed[key] = value.strip()[:500]
    return parsed or None


def _apply_llm(state: MatchState, narratives: dict[str, dict], cited: list[str]) -> tuple[dict[str, dict], str]:
    if not state.use_llm:
        state.llm_notes.append("skipped")
        return narratives, "template"
    allowed = []
    evidence = state.evidence or {}
    for key in cited:
        record = evidence.get(key)
        if isinstance(record, dict):
            for field, value in record.items():
                if str(field).endswith("_display") and isinstance(value, str):
                    allowed.append(value)
    user = (
        "Rewrite the three captions. Keep every decimal exactly as written.\n"
        f"Allowed decimals: {', '.join(allowed) or 'none'}\n"
        f"casual: {narratives['casual']['caption']}\n"
        f"analyst: {narratives['analyst']['caption']}\n"
        f"zh: {narratives['zh']['caption']}"
    )
    raw = complete(_LLM_SYSTEM, user)
    if not raw:
        state.llm_notes.append(f"{provider_name()}:fallback")
        return narratives, "fallback"
    parsed = _parse_modes(raw)
    if not parsed:
        copied = {mode: dict(block) for mode, block in narratives.items()}
        copied["casual"]["caption"] = raw.strip()[:500]
        state.llm_notes.append(f"{provider_name()}:unparsed")
        return copied, "unparsed"
    copied = {mode: dict(block) for mode, block in narratives.items()}
    for mode, text in parsed.items():
        copied[mode]["caption"] = text
    state.llm_notes.append(f"{provider_name()}:parsed")
    return copied, "parsed"


class IngestAgent(Executor):
    def __init__(self, state: MatchState) -> None:
        super().__init__(id="ingest")
        self.state = state

    @handler
    async def handle(self, seed_text: str, ctx: WorkflowContext[Envelope]) -> None:
        seed = int(str(seed_text).strip())
        self.state.seed = seed
        self.state.generated = generate(seed)
        phase = self.state.generated["phase"]
        envelope = self.state.log(
            Envelope(
                sender="ingest",
                receiver="analyst",
                intent="match_ready",
                payload={
                    "match_id": self.state.generated["match"]["id"],
                    "event_count": len(self.state.generated["events"]),
                    "frame_count": phase["frame_count"],
                    "hz": phase["hz"],
                    "decision_event_id": "ev_decision",
                },
                evidence_ids=["ev_decision"],
            )
        )
        await ctx.send_message(envelope)


class AnalystAgent(Executor):
    def __init__(self, state: MatchState) -> None:
        super().__init__(id="analyst")
        self.state = state

    @handler
    async def handle(self, message: Envelope, ctx: WorkflowContext[Envelope]) -> None:
        generated = self.state.generated
        if generated is None:
            raise RuntimeError("analyst received no match")
        self.state.analysis = analyse(generated)
        self.state.evidence = evidence_book(generated, self.state.analysis)
        retry = message.intent == "qa_reject"
        ranking = self.state.analysis["ranking"]
        envelope = self.state.log(
            Envelope(
                sender="analyst",
                receiver="director",
                intent="analysis_reconfirmed" if retry else "analysis_ready",
                payload={
                    "actor_id": self.state.analysis["actor_id"],
                    "frame_index": self.state.analysis["frame_index"],
                    "ranking": ranking[:4],
                    "best_id": ranking[0],
                    "reconfirmed": retry,
                    "note": (
                        "Evidence recomputed from the decision frame. Director must resubmit the words."
                        if retry
                        else "Shot xG and pass expected value are ready."
                    ),
                },
                evidence_ids=list(self.state.analysis["evidence"].keys()) + ["tr_decision", "ev_decision"],
            )
        )
        await ctx.send_message(envelope)


class DirectorAgent(Executor):
    def __init__(self, state: MatchState) -> None:
        super().__init__(id="director")
        self.state = state

    @handler
    async def handle(self, message: Envelope, ctx: WorkflowContext[Envelope]) -> None:
        del message
        analysis = self.state.analysis
        generated = self.state.generated
        evidence = self.state.evidence
        if analysis is None or generated is None or evidence is None:
            raise RuntimeError("director received no analysis")
        taken = next(item for item in analysis["passes"] if item["taken"])
        untaken = [item for item in analysis["passes"] if not item["taken"]]
        best_pass = max(untaken, key=lambda item: (item["decision_score"], item["id"]))
        shot = analysis["shot"]
        alternatives = [best_pass, shot]
        quiz = [taken, best_pass, shot]
        random.Random(self.state.seed).shuffle(quiz)
        cited = [
            "ev_decision",
            "tr_decision",
            "an_pressure",
            taken["evidence_id"],
            best_pass["evidence_id"],
            shot["evidence_id"],
        ]
        moment = {
            "event_id": analysis["decision_event_id"],
            "actor_id": analysis["actor_id"],
            "frame_index": analysis["frame_index"],
            "taken": taken,
            "alternatives": alternatives,
            "quiz_options": quiz,
            "evidence_ids": cited,
        }
        narratives = clean_narratives(moment, generated["players"], evidence)
        note = "template"
        if self.state.rejections == 0:
            decoy = choose_decoy(evidence, cited)
            narratives = with_draft_decoy(narratives, decoy)
            note = "draft_decoy"
        elif self.state.rejections == 1:
            narratives, note = _apply_llm(self.state, narratives, cited)
        else:
            note = "template_forced"
            self.state.llm_notes.append("forced_template")
        moment["narratives"] = narratives
        self.state.moment = moment
        envelope = self.state.log(
            Envelope(
                sender="director",
                receiver="qa",
                intent="moment_submitted",
                payload={
                    "attempt": self.state.rejections + 1,
                    "text_source": note,
                    "event_id": moment["event_id"],
                    "taken_id": taken["id"],
                    "alternative_ids": [item["id"] for item in alternatives],
                    "captions": _captions(narratives),
                },
                evidence_ids=cited,
            )
        )
        await ctx.send_message(envelope)


class QAAgent(Executor):
    def __init__(self, state: MatchState) -> None:
        super().__init__(id="qa")
        self.state = state

    @handler
    async def handle(self, message: Envelope, ctx: WorkflowContext[Envelope]) -> None:
        moment = self.state.moment
        evidence = self.state.evidence
        if moment is None or evidence is None:
            raise RuntimeError("qa received no moment")
        reasons = review_claims(moment, evidence)
        cited = list(moment["evidence_ids"])
        if reasons and self.state.rejections < 2:
            self.state.rejections += 1
            envelope = self.state.log(
                Envelope(
                    sender="qa",
                    receiver="analyst",
                    intent="qa_reject",
                    payload={
                        "accepted": False,
                        "reasons": reasons,
                        "attempt": self.state.rejections,
                        "rejected_submission": message.payload.get("attempt"),
                        "ask": (
                            "Analyst, reconfirm the evidence. "
                            "Director, resubmit the moment without numbers that the cited evidence does not contain."
                        ),
                    },
                    evidence_ids=cited,
                )
            )
            await ctx.send_message(envelope)
            return
        if reasons:
            raise RuntimeError("qa still rejecting after retry budget: " + "; ".join(reasons))
        self.state.qa_passed = True
        envelope = self.state.log(
            Envelope(
                sender="qa",
                receiver="overlay",
                intent="qa_pass",
                payload={
                    "accepted": True,
                    "reasons": [],
                    "rejections_before_pass": self.state.rejections,
                },
                evidence_ids=cited,
            )
        )
        await ctx.send_message(envelope)


class OverlayAgent(Executor):
    def __init__(self, state: MatchState) -> None:
        super().__init__(id="overlay")
        self.state = state

    @handler
    async def handle(self, message: Envelope, ctx: WorkflowContext[Envelope]) -> None:
        del message
        if self.state.generated is None or self.state.moment is None:
            raise RuntimeError("overlay received no moment")
        document = build_timeline({"generated": self.state.generated, "moment": self.state.moment})
        errors = validate_timeline(document)
        if errors:
            raise RuntimeError("timeline schema: " + "; ".join(errors))
        self.state.timeline = document
        envelope = self.state.log(
            Envelope(
                sender="overlay",
                receiver="personalize",
                intent="timeline_ready",
                payload={
                    "frame_count": len(document["frames"]),
                    "ghost_ids": [ghost["id"] for ghost in document["ghosts"]],
                    "modes": list(MODES),
                },
                evidence_ids=list(self.state.moment["evidence_ids"]),
            )
        )
        await ctx.send_message(envelope)


class PersonalizeAgent(Executor):
    def __init__(self, state: MatchState) -> None:
        super().__init__(id="personalize")
        self.state = state

    @handler
    async def handle(self, message: Envelope, ctx: WorkflowContext[Never, str]) -> None:
        del message
        if self.state.timeline is None:
            raise RuntimeError("personalize received no timeline")
        self.state.modes = {mode: shape_mode(self.state.timeline, mode) for mode in MODES}
        self.state.log(
            Envelope(
                sender="personalize",
                receiver="broadcast",
                intent="modes_ready",
                payload={"modes": list(MODES)},
                evidence_ids=["ev_decision"],
            )
        )
        await ctx.yield_output(
            f"seed={self.state.seed};rejections={self.state.rejections};modes={','.join(MODES)}"
        )
