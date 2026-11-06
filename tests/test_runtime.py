"""Check that the shipped runtime is complete and matches the pinned hashes."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1] / "frontend" / "static"


class RuntimeIntegrityTests(unittest.TestCase):
    def test_all_pinned_binaries_and_libraries_match(self) -> None:
        lock = json.loads((ROOT / "runtime-lock.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(lock), 11)
        for name, expected in lock.items():
            with self.subTest(resource=name):
                data = (ROOT / name).read_bytes()
                self.assertEqual(len(data), expected["bytes"])
                self.assertEqual(hashlib.sha256(data).hexdigest(), expected["sha256"])
