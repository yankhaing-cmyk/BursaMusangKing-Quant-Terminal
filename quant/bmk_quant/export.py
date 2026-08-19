from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

from .pipeline import QuantResult
from .research import METHODOLOGY_VERSION, research_payload_hash


def _atomic_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def _json_lines(records: Iterable[dict[str, Any]]) -> str:
    return "".join(
        json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
        for record in records
    )


def write_artifacts(
    result: QuantResult,
    output_directory: str | Path,
    research_outcomes: list[dict[str, Any]] | None = None,
    trade_states: list[dict[str, Any]] | None = None,
    trade_events: list[dict[str, Any]] | None = None,
) -> dict[str, Path]:
    output = Path(output_directory)
    output.mkdir(parents=True, exist_ok=True)
    (output / "quant-publish-confirmed.json").unlink(missing_ok=True)
    paths = {
        "manifest": output / "manifest.json",
        "scores": output / "scores.jsonl",
        "instruments": output / "instruments.jsonl",
        "validation": output / "validation.json",
        "ranking": output / "ranking.csv",
        "research": output / "research.jsonl",
        "research_manifest": output / "research-manifest.json",
        "trade_states": output / "trade-states.jsonl",
        "trade_events": output / "trade-events.jsonl",
    }
    _atomic_text(
        paths["manifest"],
        json.dumps(result.manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
    )
    _atomic_text(paths["scores"], _json_lines(result.records))
    _atomic_text(paths["instruments"], _json_lines(result.instruments))
    outcomes = research_outcomes or []
    states = trade_states or []
    events = trade_events or []
    _atomic_text(paths["research"], _json_lines(outcomes))
    _atomic_text(paths["trade_states"], _json_lines(states))
    _atomic_text(paths["trade_events"], _json_lines(events))
    _atomic_text(
        paths["research_manifest"],
        json.dumps(
            {
                "computed_run_id": result.manifest["run_id"],
                "methodology_version": METHODOLOGY_VERSION,
                "expected_observations": len(outcomes),
                "payload_hash": research_payload_hash(outcomes),
            },
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
        )
        + "\n",
    )
    _atomic_text(
        paths["validation"],
        json.dumps(result.validation.as_dict(), ensure_ascii=False, sort_keys=True, indent=2)
        + "\n",
    )
    ranking_columns = [
        "rank",
        "symbol",
        "name",
        "sector",
        "close",
        "quant_score",
        "trend_score",
        "momentum_score",
        "relative_strength_score",
        "volume_score",
        "volatility_score",
        "liquidity_score",
        "price_structure_score",
        "trending_score",
        "momentum_strategy_score",
        "meta_score",
        "strategy_ensemble_score",
    ]
    csv = pd.DataFrame(result.records)[ranking_columns].to_csv(index=False, lineterminator="\n")
    _atomic_text(paths["ranking"], csv)
    return paths
