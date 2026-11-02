#!/usr/bin/env python3
"""`pnpm run build:cloud-surfaces`: bakes data/molecular-clouds/cloud-surfaces.bin
through trace_surfaces. See scripts/cloud-surfaces/README.md."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

if __name__ == "__main__":
    import trace_surfaces

    trace_surfaces.main()
