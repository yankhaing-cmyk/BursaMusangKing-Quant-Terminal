from __future__ import annotations

import hashlib
import io
import json
import os
import urllib.parse
import urllib.request
from typing import Any

import pandas as pd

from ..models import MarketDataBundle


class HttpManifestProvider:
    """Fetch a checksum-pinned bulk EOD feed without coupling to a vendor SDK."""

    def __init__(self, manifest_url: str, timeout_seconds: int = 90):
        parsed = urllib.parse.urlparse(manifest_url)
        if parsed.scheme != "https":
            raise ValueError("production manifest URL must use HTTPS")
        self.manifest_url = manifest_url
        self.timeout_seconds = timeout_seconds
        self.manifest_host = parsed.hostname

    def _download(self, url: str) -> bytes:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != self.manifest_host:
            raise ValueError("feed files must use HTTPS and the manifest host")
        headers = {"User-Agent": "BursaMusangKing-Quant/1.0"}
        token = os.environ.get("BMK_DATA_FEED_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
            final = urllib.parse.urlparse(response.geturl())
            if final.scheme != "https" or final.hostname != self.manifest_host:
                raise ValueError("feed redirect left the approved HTTPS host")
            declared = int(response.headers.get("Content-Length") or "0")
            maximum = 400 * 1024 * 1024
            if declared > maximum:
                raise ValueError("feed response exceeds 400 MiB")
            content = response.read(maximum + 1)
            if len(content) > maximum:
                raise ValueError("feed response exceeds 400 MiB")
            return content

    def _checked_csv(self, entry: dict[str, Any]) -> pd.DataFrame:
        url = str(entry.get("url") or "")
        expected = str(entry.get("sha256") or "").lower()
        if len(expected) != 64:
            raise ValueError("every feed file requires a SHA-256 checksum")
        content = self._download(url)
        actual = hashlib.sha256(content).hexdigest()
        if actual != expected:
            raise ValueError(f"feed checksum mismatch for {url}")
        return pd.read_csv(io.BytesIO(content))

    def fetch(self) -> MarketDataBundle:
        manifest_bytes = self._download(self.manifest_url)
        manifest = json.loads(manifest_bytes.decode("utf-8"))
        files = manifest.get("files") or {}
        if set(files) < {"instruments", "bars", "benchmarks"}:
            raise ValueError("manifest must declare instruments, bars and benchmarks")
        return MarketDataBundle(
            instruments=self._checked_csv(files["instruments"]),
            bars=self._checked_csv(files["bars"]),
            benchmarks=self._checked_csv(files["benchmarks"]),
            provider=str(manifest.get("provider") or "https-bulk-feed"),
            source_market_date=manifest.get("market_date"),
            metadata={
                "manifest_url": self.manifest_url,
                "licence": manifest.get("licence"),
                "fixture": False,
            },
        )
