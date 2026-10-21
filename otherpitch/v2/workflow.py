"""Microsoft Agent Framework workflow for one scene/variant, using a real MCP client.

Director -> Analyst -> Fan Editor -> QA -(reject, <=2)-> Fan Editor
                                      -(pass)-> Publisher
Director -(invalid input)-> Rejector ; QA -(unrecoverable)-> Rejector
Arithmetic and claim validation are code. Agents decide what to request, which
focus to explain, how to word it, and whether a draft ships. Normal runs are not
forced to fail; --fault-injection adds one labelled wrong-subject claim.
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Never

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from otherpitch import llm
from otherpitch.framework import FRAMEWORK, Executor, WorkflowBuilder, WorkflowContext, handler
from otherpitch.v2 import ENGINE_VERSION, POLICY_VERSION, SCHEMA_VERSION
from otherpitch.v2 import jev
from otherpitch.v2.evidence import FOCUS_LABELS, explain_action, select_focus
from otherpitch.v2.qa import validate_explanation, validate_text
from otherpitch.v2.scenarios import get_scenario
from otherpitch.v2.simulation import canonical_hash

MAX_REVISIONS = 2


@dataclass
class Msg:
    sender: str
    intent: str
    payload: dict[str, Any] = field(default_factory=dict)


class McpBridge:
    """Logs every real MCP tool call made through the client session."""

    def __init__(self, session: ClientSession, trace: "Run"):
        self.session, self.trace = session, trace

    async def call(self, agent: str, tool: str, args: dict) -> dict:
        t = time.perf_counter()
        res = await self.session.call_tool(tool, args)
        data = res.structuredContent
        if isinstance(data, dict) and set(data) == {"result"}:
            data = data["result"]
        if data is None:
            data = json.loads(res.content[0].text)
        ms = round((time.perf_counter() - t) * 1000, 1)
        summary = {k: data[k] for k in ("status", "snapshot_id", "branch_ref", "missing") if isinstance(data, dict) and k in data}
        if isinstance(data, dict) and "metric_evidence_ids" in data:
            summary["metric_evidence_ids"] = data["metric_evidence_ids"]
        if isinstance(data, dict) and "evidence" in data and isinstance(data["evidence"], dict):
            summary["evidence_ids_returned"] = sorted(data["evidence"])
        self.trace.tool_calls.append({"agent": agent, "tool": tool, "args": args, "result": summary,
                                      "ms": ms, "is_error": bool(res.isError)})
        return data


@dataclass
class Run:
    scene: str
    variant: str
    fault_injection: bool = False
    run_id: str = field(default_factory=lambda: "run-" + uuid.uuid4().hex[:12])
    steps: list = field(default_factory=list)
    tool_calls: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    mcp: McpBridge | None = None
    snapshot: dict | None = None
    actions: list = field(default_factory=list)
    branches: dict = field(default_factory=dict)
    base_branches: dict | None = None
    evidence: dict = field(default_factory=dict)
    focus: str = ""
    focus_trigger: dict = field(default_factory=dict)
    explanations: dict = field(default_factory=dict)
    revisions: int = 0
    qa_status: str = ""
    result: str = ""
    bundle: dict | None = None
    llm_notes: list = field(default_factory=list)

    def step(self, agent, intent, detail):
        self.steps.append({"i": len(self.steps), "agent": agent, "intent": intent, "detail": detail,
                           "at": datetime.now(timezone.utc).isoformat(timespec="milliseconds")})


class Director(Executor):
    def __init__(self, run: Run):
        super().__init__(id="moment_director")
        self.run = run

    @handler
    async def handle(self, message: str, ctx: WorkflowContext[Msg]) -> None:
        r = self.run
        snap = await r.mcp.call("moment_director", "get_decision_snapshot", {"scenario_id": r.scene, "variant_id": r.variant})
        if snap.get("status") != "ok":
            r.step("moment_director", "rejected_input", snap)
            await ctx.send_message(Msg("moment_director", "reject_input", snap))
            return
        r.snapshot = snap["snapshot"]
        legal = await r.mcp.call("moment_director", "list_legal_actions", {"snapshot_id": snap["snapshot_id"]})
        actions = legal["actions"]
        types = {a["type"] for a in actions}
        if len(actions) < 2:
            r.step("moment_director", "skip_moment", {"reason": "fewer than two legal actions; nothing to compare"})
            await ctx.send_message(Msg("moment_director", "reject_input", {"reason": "no comparable choice"}))
            return
        r.actions = actions
        need_base = r.snapshot.get("intervention") is not None
        brief = {"snapshot_id": snap["snapshot_id"], "state_hash": r.snapshot["state_hash"],
                 "candidate_actions": [a["action_id"] for a in actions], "action_types": sorted(types),
                 "recorded_action_id": r.snapshot.get("recorded_action_id"),
                 "request_base_comparison": need_base,
                 "reason": ("intervention declared: compare against base with the same rules" if need_base
                            else "multiple legal actions from one frozen state")}
        r.step("moment_director", "decision_brief", brief)
        await ctx.send_message(Msg("moment_director", "brief_ready", brief))


class Analyst(Executor):
    def __init__(self, run: Run):
        super().__init__(id="replay_analyst")
        self.run = run

    @handler
    async def handle(self, message: Msg, ctx: WorkflowContext[Msg]) -> None:
        r, brief = self.run, message.payload
        ev_ids = []
        for aid in brief["candidate_actions"]:
            res = await r.mcp.call("replay_analyst", "simulate_branch",
                                   {"snapshot_id": brief["snapshot_id"], "action_id": aid, "include_frames": True})
            if res.get("status") != "ok":
                r.errors.append({"stage": "simulation_failed", "detail": res})
                await ctx.send_message(Msg("replay_analyst", "reject_input", {"reason": "simulation_failed", "detail": res}))
                return
            r.branches[aid] = res["branch"]
            ev_ids += res["metric_evidence_ids"]
        if brief["request_base_comparison"]:
            r.base_branches = {}
            base_id = f"{r.scene}:base"
            for aid in brief["candidate_actions"]:
                res = await r.mcp.call("replay_analyst", "simulate_branch", {"snapshot_id": base_id, "action_id": aid})
                r.base_branches[aid] = res["branch"]
        got = await r.mcp.call("replay_analyst", "get_evidence", {"evidence_ids": ev_ids})
        if got["missing"]:
            r.errors.append({"stage": "missing_evidence", "ids": got["missing"]})
        r.evidence = got["evidence"]
        focus, trigger = select_focus(r.snapshot, r.branches, r.base_branches)
        jlabel, jstatus = jev.select_focus(r.scene, canonical_hash(r.evidence), trigger, FOCUS_LABELS)
        if jlabel:
            focus = jlabel
        r.focus, r.focus_trigger = focus, trigger
        ranked = sorted(r.branches.values(), key=lambda b: -b["metrics"]["opportunity_value"])
        r.step("replay_analyst", "analysis_bundle", {
            "metric_evidence_ids": sorted(r.evidence), "focus": focus, "focus_trigger": trigger,
            "focus_source": "jev" if jlabel else "rules", "optional_evaluator": jstatus,
            "ranking_by_opportunity_value": [b["action_id"] for b in ranked],
            "uncertainty": "heuristic coefficients; one representative trajectory per action"})
        await ctx.send_message(Msg("replay_analyst", "analysis_ready", {"focus": focus}))


_LLM_SYSTEM = ("You rewrite one short sentence of football explanation for casual fans. Keep the meaning. "
               "Do not add any numbers, names, history or outcomes that are not in the sentence. Reply with the sentence only.")


class FanEditor(Executor):
    def __init__(self, run: Run):
        super().__init__(id="fan_editor")
        self.run = run

    @handler
    async def handle(self, message: Msg, ctx: WorkflowContext[Msg]) -> None:
        r = self.run
        revising = message.intent == "qa_reject"
        hints = get_scenario(r.scene).get("explanation_hints") or {}
        rejected = set(message.payload.get("action_ids", [])) if revising else set()
        for a in r.actions:
            aid = a["action_id"]
            if revising and aid not in rejected:
                continue
            full = next(x for x in get_scenario(r.scene)["actions"] if x["action_id"] == aid)
            others = [b for k, b in r.branches.items() if k != aid]
            spec = explain_action(r.snapshot | {"actions": r.actions}, full, r.branches[aid], others, r.focus, r.evidence, hints, r.focus_trigger)
            if not revising and llm.provider_name() not in llm.OFFLINE:
                text = llm.complete(_LLM_SYSTEM, spec["casual"]["sentence"])
                if text:
                    spec["casual"]["sentence"], spec["llm_status"] = text[:300], f"rewritten:{llm.model_id()}"
                else:
                    spec["llm_status"] = f"fallback_template ({llm.last_error() or 'no output'})"
            if revising:
                spec["llm_status"] = "revised_from_template"
            r.explanations[aid] = spec
        if r.fault_injection and not revising:
            victim = r.explanations[r.actions[0]["action_id"]]
            wrong = next(a["action_id"] for a in r.actions[1:])
            victim["claims"][0]["subject"]["action_id"] = wrong
            victim["fault_injected"] = {"diagnostic": True, "change": f"claim subject.action_id -> {wrong}"}
            r.step("fan_editor", "fault_injection", {"diagnostic": True, "action_id": victim["action_id"],
                                                     "claim_id": victim["claims"][0]["claim_id"], "wrong_subject": wrong})
        r.step("fan_editor", "revised_draft" if revising else "explanation_draft",
               {"actions": sorted(r.explanations) if not revising else sorted(rejected),
                "llm_provider": llm.provider_name(), "claims": sum(len(s["claims"]) for s in r.explanations.values())})
        await ctx.send_message(Msg("fan_editor", "draft_ready", {}))


class QA(Executor):
    def __init__(self, run: Run):
        super().__init__(id="qa")
        self.run = run

    @handler
    async def handle(self, message: Msg, ctx: WorkflowContext[Msg]) -> None:
        r = self.run
        bad = {}
        for aid, spec in r.explanations.items():
            errs = validate_explanation(spec, r.evidence, {"scenario_id": r.scene, "variant_id": r.variant})
            if errs:
                bad[aid] = errs
        if not bad:
            r.qa_status = "validated_first_pass" if r.revisions == 0 else "validated_after_revision"
            r.step("qa", "qa_pass", {"status": r.qa_status, "claims_checked": sum(len(s["claims"]) for s in r.explanations.values())})
            await ctx.send_message(Msg("qa", "qa_pass", {}))
            return
        if r.revisions < MAX_REVISIONS:
            r.revisions += 1
            r.step("qa", "claim_rejected", {"errors": bad, "revision": r.revisions})
            await ctx.send_message(Msg("qa", "qa_reject", {"action_ids": sorted(bad)}))
            return
        r.qa_status = "rejected_unrecoverable"
        r.step("qa", "qa_fail", {"errors": bad})
        await ctx.send_message(Msg("qa", "reject_input", {"reason": "claims could not be validated", "errors": bad}))


class Publisher(Executor):
    def __init__(self, run: Run):
        super().__init__(id="publisher")
        self.run = run

    @handler
    async def handle(self, message: Msg, ctx: WorkflowContext[Never, str]) -> None:
        r = self.run
        r.result = "published"
        r.step("publisher", "bundle_ready", {"bundle_id": f"{r.scene}:{r.variant}:{ENGINE_VERSION}"})
        await ctx.yield_output("published")


class Rejector(Executor):
    def __init__(self, run: Run):
        super().__init__(id="rejector")
        self.run = run

    @handler
    async def handle(self, message: Msg, ctx: WorkflowContext[Never, str]) -> None:
        self.run.result = "rejected"
        self.run.step("rejector", "rejected", message.payload)
        await ctx.yield_output("rejected")


def build(run: Run):
    d, a, e, q, p, x = Director(run), Analyst(run), FanEditor(run), QA(run), Publisher(run), Rejector(run)
    return (WorkflowBuilder(start_executor=d, max_iterations=30, name="other-pitch-v2")
            .add_edge(d, a, condition=lambda m: m.intent == "brief_ready")
            .add_edge(d, x, condition=lambda m: m.intent == "reject_input")
            .add_edge(a, e, condition=lambda m: m.intent == "analysis_ready")
            .add_edge(a, x, condition=lambda m: m.intent == "reject_input")
            .add_edge(e, q)
            .add_edge(q, e, condition=lambda m: m.intent == "qa_reject")
            .add_edge(q, p, condition=lambda m: m.intent == "qa_pass")
            .add_edge(q, x, condition=lambda m: m.intent == "reject_input")
            .build())


def server_params() -> StdioServerParameters:
    return StdioServerParameters(command=sys.executable, args=["-m", "otherpitch.v2.mcp_server"])


async def run_scene(scene: str, variant: str = "base", *, fault_injection: bool = False, session: ClientSession | None = None) -> Run:
    run = Run(scene, variant, fault_injection=fault_injection)
    if session is None:
        async with stdio_client(server_params()) as (rd, wr):
            async with ClientSession(rd, wr) as s:
                await s.initialize()
                return await _go(run, s)
    return await _go(run, session)


async def _go(run: Run, session: ClientSession) -> Run:
    run.mcp = McpBridge(session, run)
    t = time.perf_counter()
    await build(run).run(f"{run.scene}:{run.variant}")
    run.elapsed_ms = round((time.perf_counter() - t) * 1000, 1)
    return run


def trace_document(run: Run) -> dict:
    return {
        "run_id": run.run_id, "framework": FRAMEWORK, "framework_package": "agent-framework==1.22.0" if FRAMEWORK == "agent_framework" else "shim",
        "mcp": {"transport": "stdio", "server": "otherpitch.v2.mcp_server", "client": "mcp.ClientSession"},
        "actual_model_ids": {"explainer": llm.model_id(), "focus_evaluator": "rules" + (" (+jev)" if jev.enabled() else "")},
        "engine_version": ENGINE_VERSION, "policy_version": POLICY_VERSION, "schema_version": SCHEMA_VERSION,
        "scene": run.scene, "variant": run.variant, "fault_injection": run.fault_injection,
        "result": run.result, "qa_status": run.qa_status, "revisions": run.revisions,
        "steps": run.steps, "tool_calls": run.tool_calls, "errors": run.errors,
        "elapsed_ms": getattr(run, "elapsed_ms", None), "cache_status": "producer_generation",
    }


def run_sync(scene: str, variant: str = "base", **kw) -> Run:
    return asyncio.run(run_scene(scene, variant, **kw))
