from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.util.stamp_hash import HASH_CHUNK_BYTES, hash_bytes, hash_file  # noqa: E402


class StampHashTest(unittest.TestCase):
    def test_is_sha1_in_hex_as_typescript_pins_it(self) -> None:
        self.assertEqual(hash_bytes(b""), "da39a3ee5e6b4b0d3255bfef95601890afd80709")
        self.assertEqual(hash_bytes(b"a\n"), "3f786850e387550fdab836ed7e6dc881de23001b")

    def test_hashes_a_file_longer_than_one_read_chunk_as_the_bytes_it_holds(self) -> None:
        data = bytes(i % 251 for i in range(HASH_CHUNK_BYTES + 1))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "big.bin"
            path.write_bytes(data)
            self.assertEqual(hash_file(path), hash_bytes(data))


if __name__ == "__main__":
    unittest.main()
