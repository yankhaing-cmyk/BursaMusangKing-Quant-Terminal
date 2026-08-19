from __future__ import annotations

import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable


class PublishError(RuntimeError):
    pass


def _read_json_lines(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def _chunks(values: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


class QuantPublisher:
    def __init__(self, api_base: str, token: str, attempts: int = 3):
        parsed = urllib.parse.urlparse(api_base)
        if parsed.scheme != "https":
            raise ValueError("publish API must use HTTPS")
        if len(token) < 24:
            raise ValueError("ingest token must contain at least 24 characters")
        self.api_base = api_base.rstrip("/")
        self.token = token
        self.attempts = attempts

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        request = urllib.request.Request(
            f"{self.api_base}{path}",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "User-Agent": "BursaMusangKing-Quant-Publisher/1.0",
            },
        )
        last_error: Exception | None = None
        for attempt in range(self.attempts):
            try:
                with urllib.request.urlopen(
                    request,
                    timeout=60,
                    context=ssl.create_default_context(),
                ) as response:
                    result = json.loads(response.read().decode("utf-8"))
                    if not result.get("ok"):
                        raise PublishError(str(result.get("error") or "publish rejected"))
                    return result
            except urllib.error.HTTPError as error:
                message = error.read().decode("utf-8", errors="replace")[:500]
                if error.code < 500 or attempt == self.attempts - 1:
                    raise PublishError(f"publish rejected with HTTP {error.code}: {message}") from error
                last_error = error
            except (urllib.error.URLError, TimeoutError) as error:
                last_error = error
                if attempt == self.attempts - 1:
                    break
            time.sleep(2**attempt)
        raise PublishError(f"publish transport failed: {type(last_error).__name__}")

    def publish(self, artifact_directory: str | Path) -> dict[str, Any]:
        directory = Path(artifact_directory)
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        scores = _read_json_lines(directory / "scores.jsonl")
        instruments = _read_json_lines(directory / "instruments.jsonl")
        if len(scores) != manifest["expected_symbols"] or len(instruments) != len(scores):
            raise PublishError("artifact counts do not match the signed manifest")
        instrument_by_symbol = {row["symbol"]: row for row in instruments}
        if len(instrument_by_symbol) != len(instruments):
            raise PublishError("duplicate instruments in artifacts")

        research_path = directory / "research.jsonl"
        research_manifest_path = directory / "research-manifest.json"
        research = _read_json_lines(research_path) if research_path.exists() else []
        research_manifest = (
            json.loads(research_manifest_path.read_text(encoding="utf-8"))
            if research_manifest_path.exists()
            else None
        )

        start = self._post("/api/admin/runs/start", manifest)
        run_id = str(manifest["run_id"])
        quant_result = start
        if start.get("status") != "already_active":
            for batch in _chunks(scores, 40):
                batch_instruments = [instrument_by_symbol[row["symbol"]] for row in batch]
                self._post(
                    f"/api/admin/runs/{urllib.parse.quote(run_id, safe='')}/scores",
                    {"instruments": batch_instruments, "scores": batch},
                )
            quant_result = self._post(
                f"/api/admin/runs/{urllib.parse.quote(run_id, safe='')}/commit",
                {},
            )
        if research_manifest is None:
            return quant_result
        if len(research) != int(research_manifest["expected_observations"]):
            raise PublishError("research artifact count does not match its manifest")
        research_start = self._post("/api/admin/research/start", research_manifest)
        if research_start.get("status") != "already_active":
            for batch in _chunks(research, 40):
                self._post(
                    f"/api/admin/research/{urllib.parse.quote(run_id, safe='')}/outcomes",
                    {"outcomes": batch},
                )
            research_result = self._post(
                f"/api/admin/research/{urllib.parse.quote(run_id, safe='')}/commit",
                {},
            )
        else:
            research_result = research_start
        return {**quant_result, "research": research_result}


def token_from_environment(name: str = "BMK_INGEST_TOKEN") -> str:
    token = os.environ.get(name)
    if not token:
        raise ValueError(f"required secret {name} is not configured")
    return token
