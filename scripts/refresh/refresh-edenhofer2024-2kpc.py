#!/usr/bin/env python3
"""Pull the Edenhofer 2024 (/data/papers/index.md#edenhofer2024) dust map's 2 kpc validation
variant and record its identity in data/dust/edenhofer2024-2kpc.json. See
scripts/dust/README.md."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dust"))

import edenhofer2024  # noqa: E402

if __name__ == "__main__":
    edenhofer2024.main("2kpc")
