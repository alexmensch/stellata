#!/usr/bin/env python3
"""A Python pull's --describe and entry point, which the Edenhofer pulls
(scripts/dust/) call. See scripts/refresh/README.md."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

from paths import REPO_ROOT  # noqa: E402


def description(
    query: str,
    services: Sequence[str],
    *,
    release: str | None = None,
    request: Iterable[str] | None = None,
    request_from: Iterable[Path] = (),
) -> dict[str, Any]:
    """What a pull prints under --describe: freshness.ts parses this shape.
    `query` excludes batch values; `request` is the list a pull derives from
    the `request_from` files, which then count only through it."""
    described: dict[str, Any] = {"query": query, "services": list(services)}
    if release is not None:
        described["release"] = release
    if request is not None:
        described["request"] = list(request)
    from_paths = [Path(p).resolve().relative_to(REPO_ROOT).as_posix() for p in request_from]
    if from_paths:
        described["requestFrom"] = from_paths
    return described


def pull_main(run: Callable[[], object], describe: Callable[[], Mapping[str, Any]]) -> None:
    """A pull's entry point: `--describe` prints its description with no
    network call and no import beyond the standard library; otherwise it pulls."""
    if sys.argv[1:] == ["--describe"]:
        print(json.dumps(describe()))
        return
    sys.exit(run())
