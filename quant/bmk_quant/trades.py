from __future__ import annotations

import hashlib
import json
import math
from decimal import Decimal, ROUND_FLOOR, ROUND_HALF_UP
from typing import Any, Iterable

import pandas as pd

from .pipeline import QuantResult
from .research import score_bucket


METHODOLOGY_VERSION = "trade-v1.0.0"
ATR_STOP_MULTIPLE = 3.0
NEAR_STOP_ATR_MULTIPLE = 1.0
MINIMUM_TRADED_VALUE = 100_000.0
MINIMUM_EDGE_SAMPLE = 30
ESTABLISHED_EDGE_SAMPLE = 100
TRADE_STATES = ("FLAT", "BUY_PENDING", "OPEN", "NEAR_SELL", "CLOSED")
ACTIVE_STATES = ("BUY_PENDING", "OPEN", "NEAR_SELL")


STATE_FIELDS = (
    "run_id",
    "market_date",
    "methodology_version",
    "symbol",
    "trade_id",
    "state",
    "signal_run_id",
    "signal_date",
    "signal_score_bucket",
    "entry_date",
    "exit_date",
    "entry_price",
    "exit_price",
    "peak_close",
    "last_close",
    "atr14",
    "trailing_stop",
    "stop_distance_pct",
    "unrealized_return",
    "quant_score",
    "signal_quant_score",
    "signal_rank",
    "regime_label",
    "expected_edge_20d",
    "edge_sample_size",
    "edge_confidence",
    "reason",
)

EVENT_FIELDS = (
    "event_id",
    "run_id",
    "market_date",
    "methodology_version",
    "symbol",
    "trade_id",
    "event_type",
    "prior_state",
    "new_state",
    "event_price",
    "quant_score",
    "trailing_stop",
    "reason",
)


def _fixed(value: Any) -> str:
    if value is None:
        return ""
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ValueError("non-finite number in canonical trade record")
    return f"{numeric:.8f}"


def _canonical(record: dict[str, Any], fields: Iterable[str]) -> str:
    values: list[str] = []
    numeric = {
        "entry_price",
        "exit_price",
        "peak_close",
        "last_close",
        "atr14",
        "trailing_stop",
        "stop_distance_pct",
        "unrealized_return",
        "quant_score",
        "signal_quant_score",
        "expected_edge_20d",
        "event_price",
    }
    integers = {"signal_rank", "edge_sample_size"}
    for field in fields:
        value = record.get(field)
        if field in numeric:
            values.append(_fixed(value))
        elif field in integers:
            values.append("" if value is None else str(int(value)))
        elif field == "symbol":
            values.append(str(value or "").strip().upper())
        else:
            values.append("" if value is None else str(value).strip())
    return "\x1f".join(values)


def state_hash(record: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical(record, STATE_FIELDS).encode("utf-8")).hexdigest()


def event_hash(record: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical(record, EVENT_FIELDS).encode("utf-8")).hexdigest()


def _payload_hash(records: list[dict[str, Any]], key: str) -> str:
    lines = [f"{row[key]}:{row['row_hash']}" for row in sorted(records, key=lambda item: item[key])]
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def state_payload_hash(records: list[dict[str, Any]]) -> str:
    return _payload_hash(records, "symbol")


def event_payload_hash(records: list[dict[str, Any]]) -> str:
    return _payload_hash(records, "event_id")


def tick_size(price: float) -> Decimal:
    if price < 1.0:
        return Decimal("0.005")
    if price < 10.0:
        return Decimal("0.01")
    if price < 100.0:
        return Decimal("0.02")
    return Decimal("0.10")


def round_to_tick(price: float, *, floor: bool = False) -> float:
    if not math.isfinite(price) or price <= 0:
        raise ValueError("trade price must be positive and finite")
    value = Decimal(str(price))
    tick = tick_size(float(value))
    units = value / tick
    rounded = units.to_integral_value(rounding=ROUND_FLOOR if floor else ROUND_HALF_UP) * tick
    return round(float(rounded), 8)


def _trailing_candidate(peak: float, close: float, atr: float) -> float:
    raw = max(float(tick_size(peak)), peak - ATR_STOP_MULTIPLE * atr)
    return min(round_to_tick(raw, floor=True), round_to_tick(close, floor=True))


def _nullable(value: Any) -> float | None:
    if value is None:
        return None
    numeric = float(value)
    return round(numeric, 8) if math.isfinite(numeric) else None


def _trade_id(signal_run_id: str, symbol: str) -> str:
    digest = hashlib.sha256(f"{signal_run_id}:{symbol}".encode("utf-8")).hexdigest()
    return f"tv1-{digest[:24]}"


def _event(
    *,
    run_id: str,
    market_date: str,
    symbol: str,
    trade_id: str,
    event_type: str,
    prior_state: str,
    new_state: str,
    event_price: float | None,
    quant_score: float,
    trailing_stop: float | None,
    reason: str,
) -> dict[str, Any]:
    identity = f"{run_id}:{symbol}:{trade_id}:{event_type}"
    row: dict[str, Any] = {
        "event_id": hashlib.sha256(identity.encode("utf-8")).hexdigest(),
        "run_id": run_id,
        "market_date": market_date,
        "methodology_version": METHODOLOGY_VERSION,
        "symbol": symbol,
        "trade_id": trade_id,
        "event_type": event_type,
        "prior_state": prior_state,
        "new_state": new_state,
        "event_price": _nullable(event_price),
        "quant_score": round(float(quant_score), 6),
        "trailing_stop": _nullable(trailing_stop),
        "reason": reason,
    }
    row["row_hash"] = event_hash(row)
    return row


def _flat(result: QuantResult, record: dict[str, Any], reason: str = "NO_ACTIVE_TRADE") -> dict[str, Any]:
    return {
        "run_id": result.manifest["run_id"],
        "market_date": result.validation.market_date,
        "methodology_version": METHODOLOGY_VERSION,
        "symbol": record["symbol"],
        "trade_id": None,
        "state": "FLAT",
        "signal_run_id": None,
        "signal_date": None,
        "signal_score_bucket": None,
        "entry_date": None,
        "exit_date": None,
        "entry_price": None,
        "exit_price": None,
        "peak_close": None,
        "last_close": round(float(record["close"]), 8),
        "atr14": _nullable(record["atr_14"]),
        "trailing_stop": None,
        "stop_distance_pct": None,
        "unrealized_return": None,
        "quant_score": round(float(record["quant_score"]), 6),
        "signal_quant_score": None,
        "signal_rank": None,
        "regime_label": result.regime["regime_label"],
        "expected_edge_20d": None,
        "edge_sample_size": 0,
        "edge_confidence": "INSUFFICIENT",
        "reason": reason,
    }


def _edge(
    expected_edges: dict[tuple[str, str], tuple[int, float]],
    bucket: str,
    regime_label: str,
) -> tuple[float | None, int, str]:
    sample, average = expected_edges.get((bucket, regime_label), (0, 0.0))
    if sample < MINIMUM_EDGE_SAMPLE:
        return None, sample, "INSUFFICIENT"
    confidence = "ESTABLISHED" if sample >= ESTABLISHED_EDGE_SAMPLE else "PROVISIONAL"
    return round(float(average), 8), sample, confidence


def _current_bars(result: QuantResult) -> dict[str, dict[str, float]]:
    bars = result.bundle.bars.copy()
    bars["date"] = pd.to_datetime(bars["date"], utc=False).dt.normalize()
    current = bars[bars["date"] == pd.Timestamp(result.validation.market_date)]
    if current["symbol"].duplicated().any():
        raise RuntimeError("duplicate current-session bars in trade layer")
    return {
        str(row.symbol): {
            "open": float(row.open),
            "high": float(row.high),
            "low": float(row.low),
            "close": float(row.close),
        }
        for row in current.itertuples(index=False)
    }


def _carry_fields(result: QuantResult, record: dict[str, Any], prior: dict[str, Any]) -> dict[str, Any]:
    row = {field: prior.get(field) for field in STATE_FIELDS}
    row.update(
        {
            "run_id": result.manifest["run_id"],
            "market_date": result.validation.market_date,
            "methodology_version": METHODOLOGY_VERSION,
            "symbol": record["symbol"],
            "quant_score": round(float(record["quant_score"]), 6),
            "regime_label": result.regime["regime_label"],
        }
    )
    return row


def calculate_trade_snapshot(
    result: QuantResult,
    prior_states: list[dict[str, Any]],
    expected_edges: dict[tuple[str, str], tuple[int, float]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    run_id = str(result.manifest["run_id"])
    market_date = str(result.validation.market_date)
    records = {str(row["symbol"]): row for row in result.records}
    if len(records) != len(result.records):
        raise RuntimeError("duplicate score symbols in trade layer")
    prior_map = {str(row["symbol"]): row for row in prior_states}
    missing_active = sorted(
        symbol
        for symbol, row in prior_map.items()
        if row.get("state") in ACTIVE_STATES and symbol not in records
    )
    if missing_active:
        raise RuntimeError(f"active trade symbols missing from valid universe: {','.join(missing_active[:10])}")

    bars = _current_bars(result)
    states: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    closed_this_run: set[str] = set()

    for symbol, record in records.items():
        prior = prior_map.get(symbol)
        if not prior or prior.get("state") in {None, "FLAT", "CLOSED"}:
            states.append(_flat(result, record, "PRIOR_TRADE_CLOSED" if prior else "NO_ACTIVE_TRADE"))
            continue
        if prior.get("methodology_version") != METHODOLOGY_VERSION:
            raise RuntimeError(f"unsupported prior trade methodology for {symbol}")
        bar = bars.get(symbol)
        if bar is None:
            raise RuntimeError(f"missing current-session bar for active trade {symbol}")
        atr = _nullable(record.get("atr_14"))
        if atr is None or atr <= 0:
            raise RuntimeError(f"missing ATR14 for active trade {symbol}")
        prior_state = str(prior["state"])
        row = _carry_fields(result, record, prior)
        row["atr14"] = atr

        if prior_state == "BUY_PENDING":
            entry = round_to_tick(bar["open"])
            initial_stop = round_to_tick(max(tick_size(entry), Decimal(str(entry - ATR_STOP_MULTIPLE * atr))), floor=True)
            events.append(
                _event(
                    run_id=run_id,
                    market_date=market_date,
                    symbol=symbol,
                    trade_id=str(prior["trade_id"]),
                    event_type="ENTRY",
                    prior_state="BUY_PENDING",
                    new_state="OPEN",
                    event_price=entry,
                    quant_score=float(record["quant_score"]),
                    trailing_stop=initial_stop,
                    reason="NEXT_BURSA_SESSION_OPEN",
                )
            )
            row.update(
                {
                    "state": "OPEN",
                    "entry_date": market_date,
                    "entry_price": entry,
                    "exit_date": None,
                    "exit_price": None,
                    "peak_close": entry,
                    "trailing_stop": initial_stop,
                }
            )
            if bar["low"] <= initial_stop:
                exit_price = round_to_tick(bar["open"] if bar["open"] <= initial_stop else initial_stop, floor=True)
                row.update(
                    {
                        "state": "CLOSED",
                        "exit_date": market_date,
                        "exit_price": exit_price,
                        "unrealized_return": None,
                        "stop_distance_pct": None,
                        "reason": "ENTRY_DAY_STOP_TRIGGERED_BEFORE_PEAK_UPDATE",
                    }
                )
                events.append(
                    _event(
                        run_id=run_id,
                        market_date=market_date,
                        symbol=symbol,
                        trade_id=str(prior["trade_id"]),
                        event_type="EXIT",
                        prior_state="OPEN",
                        new_state="CLOSED",
                        event_price=exit_price,
                        quant_score=float(record["quant_score"]),
                        trailing_stop=initial_stop,
                        reason="ENTRY_DAY_STOP_TRIGGERED_BEFORE_PEAK_UPDATE",
                    )
                )
                closed_this_run.add(symbol)
            else:
                peak = max(entry, float(bar["close"]))
                candidate_stop = _trailing_candidate(peak, float(bar["close"]), atr)
                stop = max(initial_stop, candidate_stop)
                state = "NEAR_SELL" if float(bar["close"]) - stop <= NEAR_STOP_ATR_MULTIPLE * atr else "OPEN"
                row.update(
                    {
                        "state": state,
                        "peak_close": round(peak, 8),
                        "trailing_stop": stop,
                        "stop_distance_pct": max(0.0, round((float(bar["close"]) - stop) / float(bar["close"]), 8)),
                        "unrealized_return": round(float(bar["close"]) / entry - 1.0, 8),
                        "reason": "ENTRY_CONFIRMED_AT_NEXT_SESSION_OPEN",
                    }
                )
                if state == "NEAR_SELL":
                    events.append(
                        _event(
                            run_id=run_id,
                            market_date=market_date,
                            symbol=symbol,
                            trade_id=str(prior["trade_id"]),
                            event_type="NEAR_SELL",
                            prior_state="OPEN",
                            new_state="NEAR_SELL",
                            event_price=float(bar["close"]),
                            quant_score=float(record["quant_score"]),
                            trailing_stop=stop,
                            reason="CLOSE_WITHIN_ONE_ATR_OF_TRAILING_STOP",
                        )
                    )
        else:
            prior_stop = _nullable(prior.get("trailing_stop"))
            entry_price = _nullable(prior.get("entry_price"))
            prior_peak = _nullable(prior.get("peak_close"))
            if prior_stop is None or entry_price is None or prior_peak is None:
                raise RuntimeError(f"incomplete active trade state for {symbol}")
            previous_close = _nullable(prior.get("last_close"))
            if previous_close and not 0.5 <= bar["open"] / previous_close <= 1.5:
                raise RuntimeError(f"possible corporate-action gap in active trade {symbol}")
            if bar["low"] <= prior_stop:
                exit_price = round_to_tick(bar["open"] if bar["open"] <= prior_stop else prior_stop, floor=True)
                row.update(
                    {
                        "state": "CLOSED",
                        "exit_date": market_date,
                        "exit_price": exit_price,
                        "unrealized_return": None,
                        "stop_distance_pct": None,
                        "reason": "PRIOR_STOP_TRIGGERED_BEFORE_PEAK_UPDATE",
                    }
                )
                events.append(
                    _event(
                        run_id=run_id,
                        market_date=market_date,
                        symbol=symbol,
                        trade_id=str(prior["trade_id"]),
                        event_type="EXIT",
                        prior_state=prior_state,
                        new_state="CLOSED",
                        event_price=exit_price,
                        quant_score=float(record["quant_score"]),
                        trailing_stop=prior_stop,
                        reason="PRIOR_STOP_TRIGGERED_BEFORE_PEAK_UPDATE",
                    )
                )
                closed_this_run.add(symbol)
            else:
                peak = max(prior_peak, float(bar["close"]))
                candidate_stop = _trailing_candidate(peak, float(bar["close"]), atr)
                stop = max(prior_stop, candidate_stop)
                state = "NEAR_SELL" if float(bar["close"]) - stop <= NEAR_STOP_ATR_MULTIPLE * atr else "OPEN"
                row.update(
                    {
                        "state": state,
                        "peak_close": round(peak, 8),
                        "trailing_stop": stop,
                        "stop_distance_pct": max(0.0, round((float(bar["close"]) - stop) / float(bar["close"]), 8)),
                        "unrealized_return": round(float(bar["close"]) / entry_price - 1.0, 8),
                        "reason": "TRAILING_STOP_UPDATED_AFTER_STOP_CHECK",
                    }
                )
                if state != prior_state:
                    events.append(
                        _event(
                            run_id=run_id,
                            market_date=market_date,
                            symbol=symbol,
                            trade_id=str(prior["trade_id"]),
                            event_type="NEAR_SELL" if state == "NEAR_SELL" else "RECOVERED",
                            prior_state=prior_state,
                            new_state=state,
                            event_price=float(bar["close"]),
                            quant_score=float(record["quant_score"]),
                            trailing_stop=stop,
                            reason=(
                                "CLOSE_WITHIN_ONE_ATR_OF_TRAILING_STOP"
                                if state == "NEAR_SELL"
                                else "CLOSE_MOVED_MORE_THAN_ONE_ATR_ABOVE_STOP"
                            ),
                        )
                    )
        row["last_close"] = round(float(bar["close"]), 8)
        states.append(row)

    max_new_entries = int(result.regime["max_new_entries"])
    minimum_score = float(result.regime["minimum_quant_score"])
    by_symbol = {row["symbol"]: row for row in states}
    candidates = [
        record
        for record in result.records
        if by_symbol[record["symbol"]]["state"] == "FLAT"
        and record["symbol"] not in closed_this_run
        and float(record["quant_score"]) >= minimum_score
        and record["atr_14"] is not None
        and float(record["atr_14"]) > 0
        and record["average_traded_value_20"] is not None
        and float(record["average_traded_value_20"]) >= MINIMUM_TRADED_VALUE
        and "ILLIQUID_SCORE_CAP" not in record["quality_flags"]
        and "INTERMITTENT_TRADING" not in record["quality_flags"]
    ]
    candidates.sort(key=lambda row: (int(row["rank"]), str(row["symbol"])))
    for record in candidates[:max_new_entries]:
        symbol = str(record["symbol"])
        bucket = score_bucket(float(record["quant_score"]))
        expected_edge, sample, confidence = _edge(
            expected_edges,
            bucket,
            str(result.regime["regime_label"]),
        )
        trade_id = _trade_id(run_id, symbol)
        pending = by_symbol[symbol]
        pending.update(
            {
                "trade_id": trade_id,
                "state": "BUY_PENDING",
                "signal_run_id": run_id,
                "signal_date": market_date,
                "signal_score_bucket": bucket,
                "signal_quant_score": round(float(record["quant_score"]), 6),
                "signal_rank": int(record["rank"]),
                "expected_edge_20d": expected_edge,
                "edge_sample_size": sample,
                "edge_confidence": confidence,
                "reason": (
                    f"TOP_RANKED_SCORE_{float(record['quant_score']):.2f}_MEETS_"
                    f"REGIME_MINIMUM_{minimum_score:.0f}"
                ),
            }
        )
        events.append(
            _event(
                run_id=run_id,
                market_date=market_date,
                symbol=symbol,
                trade_id=trade_id,
                event_type="SIGNAL",
                prior_state="FLAT",
                new_state="BUY_PENDING",
                event_price=float(record["close"]),
                quant_score=float(record["quant_score"]),
                trailing_stop=None,
                reason=pending["reason"],
            )
        )

    for row in states:
        row["row_hash"] = state_hash(row)
    states.sort(key=lambda row: str(row["symbol"]))
    events.sort(key=lambda row: str(row["event_id"]))
    manifest = {
        "methodology_version": METHODOLOGY_VERSION,
        "expected_states": len(states),
        "state_payload_hash": state_payload_hash(states),
        "expected_events": len(events),
        "event_payload_hash": event_payload_hash(events),
        "atr_stop_multiple": ATR_STOP_MULTIPLE,
        "near_stop_atr_multiple": NEAR_STOP_ATR_MULTIPLE,
        "automatic_execution": False,
    }
    return states, events, manifest
