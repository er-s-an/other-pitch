"""Write timeline.json, trace.json, and one file per broadcast mode.

    python -m otherpitch.build --seed 7 --out web/public/data/
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from otherpitch.framework import FRAMEWORK
from otherpitch.timeline import MODES
from otherpitch.workflow import run_pipeline, trace_document


def write_bundle(state, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    _dump(out / "timeline.json", state.timeline)
    _dump(out / "trace.json", trace_document(state))
    for mode in MODES:
        _dump(out / f"{mode}.json", state.modes[mode])


def _dump(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the Other Pitch replay bundle.")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--no-llm",
        action="store_true",
        help="Force the deterministic template even if OTHERPITCH_LLM is set.",
    )
    args = parser.parse_args(argv)
    use_llm = False if args.no_llm else None
    state = run_pipeline(args.seed, use_llm=use_llm)
    write_bundle(state, args.out)
    print(
        f"framework={FRAMEWORK} seed={state.seed} "
        f"qa_rejections={state.rejections} frames={len(state.timeline['frames'])} "
        f"out={args.out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
