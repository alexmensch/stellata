#!/usr/bin/env python3
"""Refresh data/iau-wgsn/{NEC,wgsnFaints}.csv — the IAU WGSN naked-eye
catalogue + faint approved names (plain HTTP, not TAP), committed
verbatim as frozen slices. Normalisation: scripts/catalog/naming/."""

from __future__ import annotations

import csv
import io
import os
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

from paths import REPO_ROOT  # noqa: E402

OUT_DIR = REPO_ROOT / "data" / "iau-wgsn"

FILES = [
    {
        "name": "NEC.csv",
        "url": "https://exopla.net/wp-content/uploads/2025/05/NEC.csv",
        "header": "NEC,Name,HIP,RA2000,DE2000,Vmag,Gmag,type,HR,HD,"
                  "Bayer/other,constellation,distance from Sun/ ly,"
                  "B-V color,VmagMax,VmagMin",
        # The naked-eye sky is a closed set; a re-release may correct rows
        # but not grow past V<=6.5.
        "row_bounds": (9_000, 10_500),
        "min_named": 370,
        "spot_rows": {
            "5": {"HIP": "HIP 88", "Bayer/other": "τ Phoenicis"},
            "8": {"Bayer/other": "θ Octantis", "HD": "224889"},
        },
        "id_column": "NEC",
    },
    {
        "name": "wgsnFaints.csv",
        "url": "https://exopla.net/wp-content/uploads/2025/05/wgsnFaints.csv",
        "header": "WGSN-ID,Name,HIP,RA2000,DE2000,Vmag,type,HR,HD,"
                  "Bayer/other,constellation,distance from Sun/ ly,"
                  "B-V color,VmagMax,VmagMin,WDS",
        "row_bounds": (120, 400),
        "min_named": 120,
        "spot_rows": {
            "10001": {"Name": "Citadelle", "HIP": "HIP 1547"},
        },
        "id_column": "WGSN-ID",
    },
]


def fetch(url: str) -> str:
    last: Exception | None = None
    for attempt in range(3):
        try:
            resp = requests.get(url, timeout=60)
            resp.raise_for_status()
            resp.encoding = "utf-8-sig"
            return resp.text
        except requests.RequestException as exc:  # noqa: PERF203
            last = exc
            print(f"  attempt {attempt + 1}/3 failed: {exc}")
    raise SystemExit(f"could not fetch {url}: {last}")


def validate(spec: dict, text: str) -> None:
    rows = list(csv.DictReader(io.StringIO(text)))
    header = text.splitlines()[0].lstrip("﻿")
    if header != spec["header"]:
        raise SystemExit(
            f"{spec['name']}: upstream header changed.\n"
            f"  expected: {spec['header']}\n  got:      {header}\n"
            "Review the upstream release before refreshing the frozen slice."
        )
    lo, hi = spec["row_bounds"]
    if not lo <= len(rows) <= hi:
        raise SystemExit(f"{spec['name']}: {len(rows)} rows outside [{lo}, {hi}]")
    named = sum(1 for r in rows if r["Name"].strip() not in ("", "_"))
    if named < spec["min_named"]:
        raise SystemExit(
            f"{spec['name']}: only {named} named rows (< {spec['min_named']})"
        )
    by_id = {r[spec["id_column"]]: r for r in rows}
    for row_id, pins in spec["spot_rows"].items():
        row = by_id.get(row_id)
        if row is None:
            raise SystemExit(f"{spec['name']}: spot row {row_id} missing")
        for col, want in pins.items():
            got = row[col].strip()
            if got != want:
                raise SystemExit(
                    f"{spec['name']}: spot row {row_id} {col} = {got!r}, "
                    f"expected {want!r}"
                )
    print(f"  {spec['name']}: {len(rows)} rows, {named} named — gates green")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for spec in FILES:
        print(f"fetching {spec['url']}")
        text = fetch(spec["url"])
        validate(spec, text)
        out = OUT_DIR / spec["name"]
        tmp = out.with_suffix(out.suffix + ".tmp")
        tmp.write_text(text, encoding="utf-8", newline="")
        os.replace(tmp, out)
        print(f"  wrote {out}")
    print("Now re-run: pnpm run build:wgsn (and commit both if changed)")


if __name__ == "__main__":
    main()
