from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from bmk_quant.object_archive import R2ResearchArchive


class ArchiveTests(unittest.TestCase):
    def test_gzip_checkpoint_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "history.sqlite"
            compressed = root / "history.sqlite.gz"
            restored = root / "restored.sqlite"
            content = (b"BursaMusangKing-Quant\x00" * 10_000) + bytes(range(255))
            source.write_bytes(content)
            R2ResearchArchive._compress(source, compressed)
            R2ResearchArchive._decompress(compressed, restored)
            self.assertEqual(restored.read_bytes(), content)
            self.assertEqual(len(R2ResearchArchive._sha256(compressed)), 64)


if __name__ == "__main__":
    unittest.main()
