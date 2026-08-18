from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

import pandas as pd


Severity = Literal["WARNING", "CRITICAL"]


@dataclass(frozen=True)
class DataIssue:
    severity: Severity
    code: str
    detail: str
    symbol: str | None = None
    field: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "severity": self.severity,
            "code": self.code,
            "symbol": self.symbol,
            "field": self.field,
            "detail": self.detail,
        }


@dataclass
class MarketDataBundle:
    instruments: pd.DataFrame
    bars: pd.DataFrame
    benchmarks: pd.DataFrame
    provider: str
    source_market_date: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ValidationReport:
    market_date: str
    benchmark_date: str
    total_instruments: int
    valid_symbols: tuple[str, ...]
    issues: tuple[DataIssue, ...]
    checks: tuple[dict[str, Any], ...]

    @property
    def critical_count(self) -> int:
        return sum(issue.severity == "CRITICAL" for issue in self.issues)

    @property
    def warning_count(self) -> int:
        return sum(issue.severity == "WARNING" for issue in self.issues)

    @property
    def ok(self) -> bool:
        return self.critical_count == 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "market_date": self.market_date,
            "benchmark_date": self.benchmark_date,
            "total_instruments": self.total_instruments,
            "valid_symbols": len(self.valid_symbols),
            "critical_count": self.critical_count,
            "warning_count": self.warning_count,
            "checks": list(self.checks),
            "issues": [issue.as_dict() for issue in self.issues],
        }


class ValidationError(RuntimeError):
    def __init__(self, report: ValidationReport):
        self.report = report
        summary = ", ".join(
            f"{issue.code}:{issue.symbol or '-'}"
            for issue in report.issues
            if issue.severity == "CRITICAL"
        )
        super().__init__(f"quant run rejected: {summary or 'critical validation failure'}")

