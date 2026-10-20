"""The local workflow shim honours a conditional handoff."""

import asyncio

from otherpitch.shim import Executor, WorkflowBuilder, WorkflowContext, handler


class Note:
    def __init__(self, intent: str) -> None:
        self.intent = intent


class Start(Executor):
    def __init__(self) -> None:
        super().__init__(id="start")

    @handler
    async def handle(self, text: str, ctx: WorkflowContext) -> None:
        del text
        await ctx.send_message(Note("again"))


class Loop(Executor):
    def __init__(self) -> None:
        super().__init__(id="loop")
        self.seen = 0

    @handler
    async def handle(self, message: Note, ctx: WorkflowContext) -> None:
        self.seen += 1
        if message.intent == "again" and self.seen == 1:
            await ctx.send_message(Note("stop"))
        else:
            await ctx.yield_output(f"stopped-{self.seen}")


def test_shim_follows_the_retry_edge():
    start = Start()
    loop = Loop()
    workflow = (
        WorkflowBuilder(start_executor=start, max_iterations=10)
        .add_edge(start, loop)
        .add_edge(loop, loop, condition=lambda message: message.intent == "stop")
        .build()
    )
    result = asyncio.run(workflow.run("go"))
    assert result.get_outputs() == ["stopped-2"]
