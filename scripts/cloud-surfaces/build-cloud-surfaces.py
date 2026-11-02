#!/usr/bin/env python3
"""`pnpm run build:cloud-surfaces`: bakes data/molecular-clouds/cloud-surfaces.bin
through trace_surfaces. See scripts/cloud-surfaces/README.md."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import cloud_geometry  # noqa: E402

if __name__ == "__main__":
    if sys.argv[1:] == ["--describe"]:
        print(json.dumps(cloud_geometry.describe()))
    else:
        import trace_surfaces

        trace_surfaces.main()
