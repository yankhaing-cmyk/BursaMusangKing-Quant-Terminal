from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from bmk_quant.providers import DirectoryProvider
from bmk_quant.synthetic import make_synthetic_bundle, write_synthetic_directory


class ProviderContractTests(unittest.TestCase):
    def test_fixture_directory_is_marked_production_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            write_synthetic_directory(make_synthetic_bundle(), directory)
            bundle = DirectoryProvider(directory).fetch()
            self.assertTrue(bundle.metadata["fixture"])
            self.assertTrue(bundle.metadata["production_blocked"])
            self.assertEqual(len(bundle.instruments), 40)
            self.assertTrue((Path(directory) / "bars.csv").is_file())


if __name__ == "__main__":
    unittest.main()

