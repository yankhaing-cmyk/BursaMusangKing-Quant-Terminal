from __future__ import annotations

import gzip
import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
from pathlib import Path
from typing import Any


class R2ResearchArchive:
    """Durable, versioned R2 archive for the Python-side research database."""

    def __init__(
        self,
        endpoint_url: str,
        access_key_id: str,
        secret_access_key: str,
        bucket: str,
        prefix: str = "bmk-quant-phase1",
    ):
        if not endpoint_url.startswith("https://"):
            raise ValueError("R2 endpoint must use HTTPS")
        if not all((access_key_id, secret_access_key, bucket)):
            raise ValueError("R2 credentials and bucket are required")
        import boto3

        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name="auto",
        )
        self.bucket = bucket
        self.prefix = prefix.strip("/")

    @classmethod
    def from_environment(cls) -> "R2ResearchArchive":
        required = {
            "endpoint_url": os.environ.get("BMK_R2_ENDPOINT", ""),
            "access_key_id": os.environ.get("BMK_R2_ACCESS_KEY_ID", ""),
            "secret_access_key": os.environ.get("BMK_R2_SECRET_ACCESS_KEY", ""),
            "bucket": os.environ.get("BMK_R2_BUCKET", ""),
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise ValueError(f"missing R2 settings: {', '.join(missing)}")
        return cls(**required)

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _compress(source: Path, target: Path) -> None:
        with source.open("rb") as input_handle, gzip.open(target, "wb", compresslevel=6) as output:
            shutil.copyfileobj(input_handle, output, length=1024 * 1024)

    @staticmethod
    def _decompress(source: Path, target: Path) -> None:
        with gzip.open(source, "rb") as input_handle, target.open("wb") as output:
            shutil.copyfileobj(input_handle, output, length=1024 * 1024)

    def restore_latest(self, destination: str | Path) -> bool:
        destination_path = Path(destination)
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        key = f"{self.prefix}/history/latest.sqlite.gz"
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
        except Exception as error:
            code = str(getattr(error, "response", {}).get("Error", {}).get("Code", ""))
            if code in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise
        descriptor, compressed_name = tempfile.mkstemp(
            prefix=".bmk-r2-", suffix=".sqlite.gz", dir=destination_path.parent
        )
        os.close(descriptor)
        compressed = Path(compressed_name)
        database_temp = destination_path.with_name(f".{destination_path.name}.restoring")
        try:
            body = response["Body"]
            with compressed.open("wb") as output:
                shutil.copyfileobj(body, output, length=1024 * 1024)
            body.close()
            expected = str(response.get("Metadata", {}).get("sha256") or "")
            if len(expected) != 64 or self._sha256(compressed) != expected:
                raise RuntimeError("R2 research archive checksum mismatch")
            self._decompress(compressed, database_temp)
            with sqlite3.connect(database_temp) as connection:
                result = connection.execute("PRAGMA quick_check").fetchone()
                if not result or result[0] != "ok":
                    raise RuntimeError("restored research database failed integrity check")
            os.replace(database_temp, destination_path)
            return True
        finally:
            compressed.unlink(missing_ok=True)
            database_temp.unlink(missing_ok=True)

    def save_checkpoint(
        self,
        source: str | Path,
        market_date: str,
        payload_hash: str,
        manifest: dict[str, Any],
    ) -> dict[str, str]:
        source_path = Path(source)
        if not source_path.is_file():
            raise FileNotFoundError(source_path)
        with sqlite3.connect(source_path) as connection:
            result = connection.execute("PRAGMA quick_check").fetchone()
            if not result or result[0] != "ok":
                raise RuntimeError("research database failed integrity check before archive")
        descriptor, compressed_name = tempfile.mkstemp(
            prefix=".bmk-r2-", suffix=".sqlite.gz", dir=source_path.parent
        )
        os.close(descriptor)
        compressed = Path(compressed_name)
        try:
            self._compress(source_path, compressed)
            digest = self._sha256(compressed)
            versioned_key = (
                f"{self.prefix}/history/checkpoints/{market_date}-{payload_hash[:16]}.sqlite.gz"
            )
            latest_key = f"{self.prefix}/history/latest.sqlite.gz"
            extra = {
                "ContentType": "application/gzip",
                "Metadata": {
                    "sha256": digest,
                    "market-date": market_date,
                    "payload-hash": payload_hash,
                },
            }
            self.client.upload_file(str(compressed), self.bucket, versioned_key, ExtraArgs=extra)
            self.client.upload_file(str(compressed), self.bucket, latest_key, ExtraArgs=extra)
            manifest_key = f"{self.prefix}/manifests/{market_date}-{payload_hash[:16]}.json"
            self.client.put_object(
                Bucket=self.bucket,
                Key=manifest_key,
                Body=(json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode("utf-8"),
                ContentType="application/json",
            )
            verification = self.client.head_object(Bucket=self.bucket, Key=latest_key)
            if verification.get("Metadata", {}).get("sha256") != digest:
                raise RuntimeError("R2 research archive verification failed")
            return {
                "versioned_key": versioned_key,
                "latest_key": latest_key,
                "manifest_key": manifest_key,
                "archive_sha256": digest,
            }
        finally:
            compressed.unlink(missing_ok=True)

