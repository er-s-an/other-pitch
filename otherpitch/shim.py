"""Thin stand-in for Microsoft Agent Framework workflow primitives.

Used only when ``agent_framework`` cannot be imported. The surface matches
the calls this project makes: ``Executor``, ``@handler``, ``WorkflowContext``,
``WorkflowBuilder(start_executor=...).add_edge(..., condition=...).build()``
and ``await workflow.run(message)``.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any


class WorkflowContext:
    def __init__(self) -> None:
        self.messages: list[Any] = []
        self.outputs: list[Any] = []

    def __class_getitem__(cls, _item: Any) -> type[WorkflowContext]:
        return cls

    async def send_message(self, message: Any) -> None:
        self.messages.append(message)

    async def yield_output(self, output: Any) -> None:
        self.outputs.append(output)


def handler(func: Callable | None = None, **_kwargs: Any) -> Callable:
    def wrap(fn: Callable) -> Callable:
        fn.__handler__ = True  # type: ignore[attr-defined]
        return fn

    if func is None:
        return wrap
    return wrap(func)


class Executor:
    def __init__(self, id: str, **_kwargs: Any) -> None:
        self.id = id

    async def run_message(self, message: Any, ctx: WorkflowContext) -> None:
        for name in dir(self):
            fn = getattr(self, name)
            if callable(fn) and getattr(fn, "__handler__", False):
                await fn(message, ctx)
                return
        raise RuntimeError(f"{self.id} has no @handler method")


class WorkflowRunResult(list):
    def get_outputs(self) -> list[Any]:
        return list(self)


class Workflow:
    def __init__(
        self,
        start_id: str,
        nodes: dict[str, Executor],
        edges: list[tuple[str, str, Callable | None]],
        max_iterations: int,
    ) -> None:
        self.start_id = start_id
        self.nodes = nodes
        self.edges = edges
        self.max_iterations = max_iterations

    async def run(self, message: Any) -> WorkflowRunResult:
        current: str | None = self.start_id
        outputs: list[Any] = []
        steps = 0
        while current is not None:
            steps += 1
            if steps > self.max_iterations:
                raise RuntimeError("shim workflow exceeded max_iterations")
            ctx = WorkflowContext()
            await self.nodes[current].run_message(message, ctx)
            outputs.extend(ctx.outputs)
            nxt = None
            if ctx.messages:
                sent = ctx.messages[-1]
                for src, dst, condition in self.edges:
                    if src != current:
                        continue
                    if condition is None or _truthy(condition(sent)):
                        nxt = dst
                        message = sent
                        break
            current = nxt
        result = WorkflowRunResult(outputs)
        return result


def _truthy(value: Any) -> bool:
    if hasattr(value, "__await__"):
        raise RuntimeError("shim edge conditions must be synchronous")
    return bool(value)


class WorkflowBuilder:
    def __init__(
        self,
        start_executor: Executor,
        max_iterations: int = 100,
        name: str | None = None,
        **_kwargs: Any,
    ) -> None:
        self.start = start_executor
        self.max_iterations = max_iterations
        self.name = name
        self.nodes: dict[str, Executor] = {start_executor.id: start_executor}
        self.edges: list[tuple[str, str, Callable | None]] = []

    def add_edge(
        self,
        source: Executor,
        target: Executor,
        condition: Callable[[Any], bool] | None = None,
    ) -> WorkflowBuilder:
        self.nodes[source.id] = source
        self.nodes[target.id] = target
        self.edges.append((source.id, target.id, condition))
        return self

    def build(self) -> Workflow:
        return Workflow(self.start.id, self.nodes, self.edges, self.max_iterations)
