from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path

from .config import QuantConfig
from .export import write_artifacts
from .models import ValidationError
from .object_archive import R2ResearchArchive
from .pipeline import QuantPipeline
from .providers import DirectoryProvider, HttpManifestProvider, TradingViewFreeProvider
from .publisher import QuantPublisher, token_from_environment
from .storage import ResearchStore
from .synthetic import make_synthetic_bundle, write_synthetic_directory
from .trades import state_hash, state_payload_hash


def _provider(source: str, args: argparse.Namespace):
    if source in {"tradingview-free", "tradingview://free"}:
        return TradingViewFreeProvider(
            cache_dir=args.cache_dir,
            n_bars=args.bars,
            request_delay=args.request_delay,
        )
    return HttpManifestProvider(source) if source.startswith("https://") else DirectoryProvider(source)


def _normalize_trade_states_for_publish(
    trade_states: list[dict],
    trade_manifest: dict,
) -> int:
    """Normalize harmless zero ATR diagnostics on FLAT rows before publication.

    BUY_PENDING/OPEN/NEAR_SELL states already require ATR14 > 0 in the trade engine.
    A FLAT counter can legitimately have ATR14 == 0 after a no-range period; D1 ingest
    treats trade price diagnostics as positive-or-null, so publish that diagnostic as
    null rather than rejecting the entire verified universe.
    """
    changed = 0
    for row in trade_states:
        atr14 = row.get("atr14")
        if row.get("state") == "FLAT" and atr14 is not None and float(atr14) == 0.0:
            row["atr14"] = None
            row["row_hash"] = state_hash(row)
            changed += 1
    if changed:
        trade_manifest["state_payload_hash"] = state_payload_hash(trade_states)
    return changed


def run_command(args: argparse.Namespace) -> int:
    archive = R2ResearchArchive.from_environment() if args.sync_r2 else None
    if archive and args.history_db:
        archive.restore_latest(args.history_db)
    bundle = _provider(args.source, args).fetch()
    if bundle.metadata.get("fixture"):
        if not args.allow_fixture:
            raise ValueError("fixture input requires --allow-fixture and can never be published live")
        bundle = replace(bundle, metadata={**bundle.metadata, "production_blocked": False})
    config = QuantConfig(
        min_valid_universe=args.min_universe,
        max_market_age_days=None if args.allow_fixture else 7,
    )
    result = QuantPipeline(config).run(bundle)
    research_outcomes = []
    trade_states = []
    trade_events = []
    portfolio_allocations = []
    portfolio_summary = None
    if args.history_db:
        store = ResearchStore(args.history_db)
        research_outcomes = store.save(result)
        trade_states, trade_events, trade_manifest = store.build_trade_artifacts(result)
        _normalize_trade_states_for_publish(trade_states, trade_manifest)
        result.manifest["trade"] = trade_manifest
        portfolio_allocations, portfolio_summary, portfolio_manifest = store.build_portfolio_artifacts(
            result,
            trade_states,
        )
        result.manifest["portfolio"] = portfolio_manifest
        if archive:
            archive.save_checkpoint(
                args.history_db,
                result.validation.market_date,
                result.manifest["payload_hash"],
                result.manifest,
            )
    paths = write_artifacts(
        result,
        args.output,
        research_outcomes,
        trade_states,
        trade_events,
        portfolio_allocations,
        portfolio_summary,
    )
    print(
        json.dumps(
            {
                "ok": True,
                "market_date": result.validation.market_date,
                "valid_symbols": len(result.records),
                "payload_hash": result.manifest["payload_hash"],
                "research_observations": len(research_outcomes),
                "trade_states": len(trade_states),
                "trade_events": len(trade_events),
                "portfolio_allocations": len(portfolio_allocations),
                "artifacts": {name: str(path) for name, path in paths.items()},
            },
            sort_keys=True,
        )
    )
    return 0


def publish_command(args: argparse.Namespace) -> int:
    token = token_from_environment(args.token_env)
    result = QuantPublisher(args.api_base, token).publish(args.artifacts)
    print(json.dumps(result, sort_keys=True))
    return 0


def fixture_command(args: argparse.Namespace) -> int:
    if not args.explicitly_non_production:
        raise ValueError("fixture generation requires --explicitly-non-production")
    bundle = make_synthetic_bundle(args.symbols, args.days, args.market_date, args.seed)
    write_synthetic_directory(bundle, args.output)
    print(json.dumps({"ok": True, "fixture": True, "directory": str(Path(args.output))}))
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="bmk-quant")
    subparsers = root.add_subparsers(dest="command", required=True)
    run = subparsers.add_parser("run", help="validate and score a bulk market-data source")
    run.add_argument(
        "--source",
        required=True,
        help="tradingview-free, HTTPS manifest URL, or local contract directory",
    )
    run.add_argument("--output", default="artifacts/latest")
    run.add_argument("--history-db", default="artifacts/quant_history.sqlite")
    run.add_argument("--min-universe", type=int, default=900)
    run.add_argument("--cache-dir", default=".cache/tradingview")
    run.add_argument("--bars", type=int, default=400)
    run.add_argument("--request-delay", type=float, default=0.12)
    run.add_argument("--allow-fixture", action="store_true")
    run.add_argument(
        "--sync-r2",
        action="store_true",
        help="restore and checkpoint the append-only research database in R2",
    )
    run.set_defaults(function=run_command)

    publish = subparsers.add_parser("publish", help="publish a verified artifact set")
    publish.add_argument("--artifacts", default="artifacts/latest")
    publish.add_argument("--api-base", required=True)
    publish.add_argument("--token-env", default="BMK_INGEST_TOKEN")
    publish.set_defaults(function=publish_command)

    fixture = subparsers.add_parser("fixture", help="generate deterministic non-live smoke data")
    fixture.add_argument("--output", required=True)
    fixture.add_argument("--symbols", type=int, default=40)
    fixture.add_argument("--days", type=int, default=300)
    fixture.add_argument("--market-date", default="2026-08-14")
    fixture.add_argument("--seed", type=int, default=731)
    fixture.add_argument("--explicitly-non-production", action="store_true")
    fixture.set_defaults(function=fixture_command)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        return int(args.function(args))
    except ValidationError as error:
        print(json.dumps({"ok": False, "validation": error.report.as_dict()}), file=sys.stderr)
        return 2
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
