from __future__ import annotations

from typing import Protocol

from ..models import MarketDataBundle


class MarketDataProvider(Protocol):
    def fetch(self) -> MarketDataBundle:
        """Return normalized input frames without calculating any signals."""

