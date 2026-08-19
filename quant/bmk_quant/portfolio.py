from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from typing import Any, Iterable

import numpy as np
import pandas as pd

from .pipeline import QuantResult


METHODOLOGY_VERSION = "portfolio-v1.0.0"
POSITION_CAP = 0.06
SECTOR_CAP = 0.25
CORRELATION_THRESHOLD = 0.75
BASE_POSITION_RISK = 0.006
MINIMUM_TRADED_VALUE = 100_000.0
ACTIVE_STATES = {"BUY_PENDING", "OPEN", "NEAR_SELL"}
MAX_PORTFOLIO_RISK = {
    "STRONG RISK-ON": 0.06,
    "RISK-ON": 0.05,
    "NEUTRAL": 0.04,
    "RISK-OFF": 0.03,
    "STRONG RISK-OFF": 0.02,
}

ALLOCATION_FIELDS = (
    "run_id", "market_date", "methodology_version", "symbol", "trade_id",
    "trade_state", "sector", "quant_score", "last_close", "atr_pct",
    "stop_distance_pct", "average_traded_value_20", "score_multiplier",
    "volatility_multiplier", "liquidity_multiplier", "correlation_multiplier",
    "target_weight", "risk_budget", "risk_contribution",
    "volatility_contribution", "beta", "correlation_cluster",
    "sector_cap_applied", "flags_json",
)

SUMMARY_FIELDS = (
    "run_id", "market_date", "methodology_version", "regime_label",
    "max_equity_exposure", "minimum_cash_allocation", "max_portfolio_risk",
    "position_cap", "sector_cap", "correlation_threshold", "position_count",
    "capital_deployed", "cash_allocation", "portfolio_risk",
    "largest_position", "top5_concentration", "portfolio_quant_score",
    "portfolio_beta", "expected_volatility", "sector_exposure_json",
    "correlation_clusters_json", "automatic_execution",
)

NUMERIC_FIELDS = {
    "quant_score", "last_close", "atr_pct", "stop_distance_pct",
    "average_traded_value_20", "score_multiplier", "volatility_multiplier",
    "liquidity_multiplier", "correlation_multiplier", "target_weight",
    "risk_budget", "risk_contribution", "volatility_contribution", "beta",
    "max_equity_exposure", "minimum_cash_allocation", "max_portfolio_risk",
    "position_cap", "sector_cap", "correlation_threshold", "capital_deployed",
    "cash_allocation", "portfolio_risk", "largest_position",
    "top5_concentration", "portfolio_quant_score", "portfolio_beta",
    "expected_volatility",
}


def _fixed(value: Any) -> str:
    if value is None:
        return ""
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ValueError("non-finite number in canonical portfolio record")
    return f"{numeric:.8f}"


def _canonical(record: dict[str, Any], fields: Iterable[str]) -> str:
    values: list[str] = []
    for field in fields:
        value = record.get(field)
        if field in NUMERIC_FIELDS:
            values.append(_fixed(value))
        elif field in {"position_count"}:
            values.append(str(int(value)))
        elif field in {"sector_cap_applied", "automatic_execution"}:
            values.append("1" if bool(value) else "0")
        elif field == "symbol":
            values.append(str(value or "").strip().upper())
        else:
            values.append("" if value is None else str(value).strip())
    return "\x1f".join(values)


def allocation_hash(record: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical(record, ALLOCATION_FIELDS).encode("utf-8")).hexdigest()


def summary_hash(record: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical(record, SUMMARY_FIELDS).encode("utf-8")).hexdigest()


def allocation_payload_hash(records: list[dict[str, Any]]) -> str:
    lines = [f"{row['symbol']}:{row['row_hash']}" for row in sorted(records, key=lambda item: item["symbol"])]
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def _multiplier_score(score: float) -> float:
    return float(np.clip(0.50 + (score - 70.0) * 0.025, 0.50, 1.25))


def _multiplier_volatility(atr_pct: float) -> float:
    if atr_pct <= 0.03:
        return 1.0
    if atr_pct <= 0.05:
        return 0.85
    if atr_pct <= 0.08:
        return 0.65
    return 0.45


def _multiplier_liquidity(adtv: float) -> float:
    if adtv >= 5_000_000:
        return 1.0
    if adtv >= 1_000_000:
        return 0.85
    if adtv >= 250_000:
        return 0.65
    if adtv >= MINIMUM_TRADED_VALUE:
        return 0.45
    raise RuntimeError("active trade fell below the Phase 5 liquidity floor")


def _returns(result: QuantResult, symbols: list[str]) -> tuple[pd.DataFrame, pd.Series]:
    bars = result.bundle.bars[result.bundle.bars["symbol"].isin(symbols)].copy()
    bars["date"] = pd.to_datetime(bars["date"], utc=False).dt.normalize()
    pivot = bars.pivot(index="date", columns="symbol", values="close").sort_index().tail(61)
    if len(pivot) < 61 or pivot.isna().any().any():
        raise RuntimeError("insufficient aligned 60-session history for portfolio correlation")
    stock_returns = pivot.pct_change(fill_method=None).dropna()

    benchmark = result.bundle.benchmarks.copy()
    benchmark["date"] = pd.to_datetime(benchmark["date"], utc=False).dt.normalize()
    benchmark = benchmark[benchmark["benchmark"] == "FBMKLCI"].sort_values("date").tail(61)
    if len(benchmark) < 61:
        raise RuntimeError("insufficient FBM KLCI history for portfolio beta")
    market_returns = benchmark.set_index("date")["close"].pct_change(fill_method=None).dropna()
    common = stock_returns.index.intersection(market_returns.index)
    if len(common) < 60:
        raise RuntimeError("stock and benchmark correlation dates are inconsistent")
    return stock_returns.loc[common, symbols], market_returns.loc[common]


def _clusters(correlations: pd.DataFrame, symbols: list[str]) -> tuple[dict[str, str], dict[str, list[str]]]:
    parent = {symbol: symbol for symbol in symbols}

    def find(symbol: str) -> str:
        while parent[symbol] != symbol:
            parent[symbol] = parent[parent[symbol]]
            symbol = parent[symbol]
        return symbol

    def union(left: str, right: str) -> None:
        a, b = find(left), find(right)
        if a != b:
            parent[max(a, b)] = min(a, b)

    for index, left in enumerate(symbols):
        for right in symbols[index + 1:]:
            if float(correlations.loc[left, right]) >= CORRELATION_THRESHOLD:
                union(left, right)

    groups: dict[str, list[str]] = defaultdict(list)
    for symbol in symbols:
        groups[find(symbol)].append(symbol)
    ordered = sorted((sorted(members) for members in groups.values()), key=lambda members: members[0])
    clusters = {f"C{index:02d}": members for index, members in enumerate(ordered, start=1)}
    mapping = {symbol: cluster for cluster, members in clusters.items() for symbol in members}
    return mapping, clusters


def calculate_portfolio_snapshot(
    result: QuantResult,
    trade_states: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    run_id = str(result.manifest["run_id"])
    market_date = str(result.validation.market_date)
    regime_label = str(result.regime["regime_label"])
    if regime_label not in MAX_PORTFOLIO_RISK:
        raise RuntimeError("unsupported Phase 5 regime")
    records = {str(row["symbol"]): row for row in result.records}
    active = [row for row in trade_states if row.get("state") in ACTIVE_STATES]
    if len({str(row["symbol"]) for row in active}) != len(active):
        raise RuntimeError("duplicate active trade symbols in portfolio layer")

    max_exposure = float(result.regime["max_equity_exposure"])
    minimum_cash = float(result.regime["minimum_cash_allocation"])
    max_risk = MAX_PORTFOLIO_RISK[regime_label]
    if not math.isclose(max_exposure + minimum_cash, 1.0, abs_tol=1e-8):
        raise RuntimeError("regime exposure and cash policy are inconsistent")

    if not active:
        summary: dict[str, Any] = {
            "run_id": run_id,
            "market_date": market_date,
            "methodology_version": METHODOLOGY_VERSION,
            "regime_label": regime_label,
            "max_equity_exposure": max_exposure,
            "minimum_cash_allocation": minimum_cash,
            "max_portfolio_risk": max_risk,
            "position_cap": POSITION_CAP,
            "sector_cap": SECTOR_CAP,
            "correlation_threshold": CORRELATION_THRESHOLD,
            "position_count": 0,
            "capital_deployed": 0.0,
            "cash_allocation": 1.0,
            "portfolio_risk": 0.0,
            "largest_position": 0.0,
            "top5_concentration": 0.0,
            "portfolio_quant_score": None,
            "portfolio_beta": None,
            "expected_volatility": None,
            "sector_exposure_json": "{}",
            "correlation_clusters_json": "{}",
            "automatic_execution": False,
        }
        summary["row_hash"] = summary_hash(summary)
        manifest = {
            "methodology_version": METHODOLOGY_VERSION,
            "expected_allocations": 0,
            "allocation_payload_hash": allocation_payload_hash([]),
            "summary_hash": summary["row_hash"],
            "position_cap": POSITION_CAP,
            "sector_cap": SECTOR_CAP,
            "correlation_threshold": CORRELATION_THRESHOLD,
            "automatic_execution": False,
        }
        return [], summary, manifest

    active.sort(key=lambda row: (int(row.get("signal_rank") or 10**9), str(row["symbol"])))
    symbols = [str(row["symbol"]) for row in active]
    stock_returns, market_returns = _returns(result, symbols)
    correlations = stock_returns.corr()
    cluster_map, clusters = _clusters(correlations, symbols)
    cluster_order: dict[str, int] = defaultdict(int)
    rows: list[dict[str, Any]] = []

    for trade in active:
        symbol = str(trade["symbol"])
        record = records.get(symbol)
        if record is None:
            raise RuntimeError(f"active trade missing score record: {symbol}")
        atr_pct = record.get("atr_pct")
        adtv = record.get("average_traded_value_20")
        if atr_pct is None or float(atr_pct) <= 0:
            raise RuntimeError(f"active trade missing ATR percentage: {symbol}")
        if adtv is None or float(adtv) < MINIMUM_TRADED_VALUE:
            raise RuntimeError(f"active trade lacks Phase 5 liquidity: {symbol}")
        sector = str(record.get("sector") or "").strip()
        if not sector or sector.upper() == "UNKNOWN":
            raise RuntimeError(f"active trade lacks sector: {symbol}")
        stop_distance = trade.get("stop_distance_pct")
        if trade["state"] == "BUY_PENDING":
            stop_distance = 3.0 * float(atr_pct)
        if stop_distance is None or not math.isfinite(float(stop_distance)) or float(stop_distance) < 0:
            raise RuntimeError(f"active trade has invalid stop distance: {symbol}")
        effective_stop = max(float(stop_distance), float(atr_pct))
        score_multiplier = _multiplier_score(float(record["quant_score"]))
        volatility_multiplier = _multiplier_volatility(float(atr_pct))
        liquidity_multiplier = _multiplier_liquidity(float(adtv))
        cluster = cluster_map[symbol]
        member_index = cluster_order[cluster]
        cluster_order[cluster] += 1
        correlation_multiplier = 1.0 if member_index == 0 else 0.75 if member_index == 1 else 0.50
        risk_budget = (
            BASE_POSITION_RISK
            * float(result.regime["new_position_size_multiplier"])
            * score_multiplier
            * volatility_multiplier
            * liquidity_multiplier
            * correlation_multiplier
        )
        target_weight = min(POSITION_CAP, risk_budget / effective_stop)
        flags = []
        if trade["state"] == "NEAR_SELL":
            flags.append("NEAR_SELL_NO_ADD")
        if liquidity_multiplier < 1.0:
            flags.append("LIQUIDITY_SCALED")
        if correlation_multiplier < 1.0:
            flags.append("CORRELATION_SCALED")
        row: dict[str, Any] = {
            "run_id": run_id,
            "market_date": market_date,
            "methodology_version": METHODOLOGY_VERSION,
            "symbol": symbol,
            "trade_id": str(trade["trade_id"]),
            "trade_state": str(trade["state"]),
            "sector": sector,
            "quant_score": round(float(record["quant_score"]), 6),
            "last_close": round(float(trade["last_close"]), 8),
            "atr_pct": round(float(atr_pct), 8),
            "stop_distance_pct": round(float(stop_distance), 8),
            "average_traded_value_20": round(float(adtv), 8),
            "score_multiplier": round(score_multiplier, 8),
            "volatility_multiplier": round(volatility_multiplier, 8),
            "liquidity_multiplier": round(liquidity_multiplier, 8),
            "correlation_multiplier": round(correlation_multiplier, 8),
            "target_weight": round(target_weight, 8),
            "risk_budget": round(risk_budget, 8),
            "risk_contribution": round(target_weight * effective_stop, 8),
            "volatility_contribution": None,
            "beta": None,
            "correlation_cluster": cluster,
            "sector_cap_applied": False,
            "flags_json": json.dumps(sorted(flags), separators=(",", ":")),
        }
        rows.append(row)

    sector_used: dict[str, float] = defaultdict(float)
    for row in rows:
        remaining = max(0.0, SECTOR_CAP - sector_used[row["sector"]])
        if row["target_weight"] > remaining:
            row["target_weight"] = round(remaining, 8)
            row["sector_cap_applied"] = True
            flags = json.loads(row["flags_json"])
            flags.append("SECTOR_CAP_APPLIED")
            row["flags_json"] = json.dumps(sorted(set(flags)), separators=(",", ":"))
        sector_used[row["sector"]] += row["target_weight"]

    def scale_rows(scale: float) -> None:
        for row in rows:
            row["target_weight"] = round(float(row["target_weight"]) * scale, 8)

    deployed = sum(float(row["target_weight"]) for row in rows)
    if deployed > max_exposure:
        scale_rows(max_exposure / deployed)
    for row in rows:
        effective_stop = max(float(row["stop_distance_pct"]), float(row["atr_pct"]))
        row["risk_contribution"] = round(float(row["target_weight"]) * effective_stop, 8)
    total_risk = sum(float(row["risk_contribution"]) for row in rows)
    if total_risk > max_risk:
        scale_rows(max_risk / total_risk)
        for row in rows:
            effective_stop = max(float(row["stop_distance_pct"]), float(row["atr_pct"]))
            row["risk_contribution"] = round(float(row["target_weight"]) * effective_stop, 8)

    weights = np.array([float(row["target_weight"]) for row in rows], dtype=float)
    covariance = stock_returns[symbols].cov().to_numpy(dtype=float)
    daily_variance = float(weights @ covariance @ weights)
    expected_volatility = math.sqrt(max(0.0, daily_variance) * 252.0)
    market_variance = float(market_returns.var())
    portfolio_beta = 0.0
    if market_variance <= 0 or not math.isfinite(market_variance):
        raise RuntimeError("invalid FBM KLCI variance for portfolio beta")
    marginal = covariance @ weights
    for index, row in enumerate(rows):
        beta = float(stock_returns[row["symbol"]].cov(market_returns) / market_variance)
        row["beta"] = round(beta, 8)
        portfolio_beta += float(row["target_weight"]) * beta
        contribution = 0.0 if daily_variance <= 0 else float(weights[index] * marginal[index] / daily_variance * expected_volatility)
        row["volatility_contribution"] = round(contribution, 8)

    deployed = sum(float(row["target_weight"]) for row in rows)
    total_risk = sum(float(row["risk_contribution"]) for row in rows)
    sector_exposure: dict[str, float] = defaultdict(float)
    for row in rows:
        sector_exposure[row["sector"]] += float(row["target_weight"])
    sector_json = json.dumps(
        {key: round(value, 8) for key, value in sorted(sector_exposure.items())},
        sort_keys=True,
        separators=(",", ":"),
    )
    clusters_json = json.dumps(clusters, sort_keys=True, separators=(",", ":"))
    sorted_weights = sorted((float(row["target_weight"]) for row in rows), reverse=True)
    weighted_score = sum(float(row["target_weight"]) * float(row["quant_score"]) for row in rows)
    summary = {
        "run_id": run_id,
        "market_date": market_date,
        "methodology_version": METHODOLOGY_VERSION,
        "regime_label": regime_label,
        "max_equity_exposure": round(max_exposure, 8),
        "minimum_cash_allocation": round(minimum_cash, 8),
        "max_portfolio_risk": round(max_risk, 8),
        "position_cap": POSITION_CAP,
        "sector_cap": SECTOR_CAP,
        "correlation_threshold": CORRELATION_THRESHOLD,
        "position_count": len(rows),
        "capital_deployed": round(deployed, 8),
        "cash_allocation": round(1.0 - deployed, 8),
        "portfolio_risk": round(total_risk, 8),
        "largest_position": round(max(sorted_weights, default=0.0), 8),
        "top5_concentration": round(sum(sorted_weights[:5]), 8),
        "portfolio_quant_score": round(weighted_score / deployed, 6) if deployed > 0 else None,
        "portfolio_beta": round(portfolio_beta, 8),
        "expected_volatility": round(expected_volatility, 8),
        "sector_exposure_json": sector_json,
        "correlation_clusters_json": clusters_json,
        "automatic_execution": False,
    }
    for row in rows:
        row["row_hash"] = allocation_hash(row)
    rows.sort(key=lambda row: (-float(row["risk_contribution"]), str(row["symbol"])))
    summary["row_hash"] = summary_hash(summary)
    manifest = {
        "methodology_version": METHODOLOGY_VERSION,
        "expected_allocations": len(rows),
        "allocation_payload_hash": allocation_payload_hash(rows),
        "summary_hash": summary["row_hash"],
        "position_cap": POSITION_CAP,
        "sector_cap": SECTOR_CAP,
        "correlation_threshold": CORRELATION_THRESHOLD,
        "automatic_execution": False,
    }
    return rows, summary, manifest
