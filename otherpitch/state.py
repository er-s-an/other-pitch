"""Shared match state and the A2A-style handoff envelope."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Envelope:
    """One agent-to-agent message.

    ``evidence_ids`` name the records the payload is allowed to rely on.
    """

    sender: str
    receiver: str
    intent: str
    payload: dict[str, Any]
    evidence_ids: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "sender": self.sender,
            "receiver": self.receiver,
            "intent": self.intent,
            "payload": self.payload,
            "evidence_ids": list(self.evidence_ids),
        }


@dataclass
class MatchState:
    """Mutable state every executor in one run shares."""

    seed: int
    use_llm: bool = False
    generated: dict[str, Any] | None = None
    analysis: dict[str, Any] | None = None
    evidence: dict[str, Any] | None = None
    moment: dict[str, Any] | None = None
    timeline: dict[str, Any] | None = None
    modes: dict[str, Any] | None = None
    trace: list[dict[str, Any]] = field(default_factory=list)
    rejections: int = 0
    qa_passed: bool = False
    llm_notes: list[str] = field(default_factory=list)

    def log(self, envelope: Envelope) -> Envelope:
        self.trace.append(envelope.to_dict())
        return envelope
