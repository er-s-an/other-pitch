"""Microsoft Agent Framework, or the local shim with the same interface."""

from __future__ import annotations

try:
    from agent_framework import Executor, WorkflowBuilder, WorkflowContext, handler

    FRAMEWORK = "agent_framework"
    FRAMEWORK_ERROR = ""
except Exception as exc:  # pragma: no cover - exercised when the package is absent
    from otherpitch.shim import Executor, WorkflowBuilder, WorkflowContext, handler

    FRAMEWORK = "shim"
    FRAMEWORK_ERROR = f"{type(exc).__name__}: {exc}"

__all__ = [
    "FRAMEWORK",
    "FRAMEWORK_ERROR",
    "Executor",
    "WorkflowBuilder",
    "WorkflowContext",
    "handler",
]
