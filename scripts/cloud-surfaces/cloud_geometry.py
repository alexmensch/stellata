"""The part of public/clouds.json the bake traces, as the request its record
hashes: stdlib only, so --describe runs under python3 -I -S. See
README.md#what-stales-the-bake."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
CLOUDS_JSON = REPO / "public" / "clouds.json"

GEOMETRY_FIELDS = ("id", "sid", "center", "axes", "quat", "inGrid")


def geometry_lines(catalog: dict[str, Any]) -> list[str]:
    """One line per cloud: the fields the trace reads or writes, in clouds.json order."""
    return [
        json.dumps({field: cloud[field] for field in GEOMETRY_FIELDS}, sort_keys=True)
        for cloud in catalog["clouds"]
    ]


def describe() -> dict[str, Any]:
    return {
        "request": geometry_lines(json.loads(CLOUDS_JSON.read_text())),
        "requestFrom": [CLOUDS_JSON.relative_to(REPO).as_posix()],
    }
