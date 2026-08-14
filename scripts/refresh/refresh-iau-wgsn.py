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

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

import refresh_lib as rl  # noqa: E402
from paths import REPO_ROOT  # noqa: E402

OUT_DIR = REPO_ROOT / "data" / "iau-wgsn"

# Must match NULL_SPELLINGS in scripts/catalog/naming/wgsn-parse-pure.ts:
# a spelling only one side knows makes the named-row gate here disagree
# with what the build classifies as a name.
NULL_SPELLINGS = {"", "_", "~", "-", "null"}

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
        "spot_rows": [
            {"NEC": "5", "HIP": "HIP 88", "Bayer/other": "τ Phoenicis"},
            {"NEC": "8", "Bayer/other": "θ Octantis", "HD": "224889"},
        ],
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
        "spot_rows": [
            {"WGSN-ID": "10001", "Name": "Citadelle", "HIP": "HIP 1547"},
        ],
        "id_column": "WGSN-ID",
    },
]


def fetch(url: str) -> str:
    def get() -> str:
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        resp.encoding = "utf-8-sig"
        return resp.text

    return rl.retry(get)


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
    rl.assert_row_count(
        len(rows), lo, hi, spec["name"],
        hint="upstream re-released the catalogue — review before committing.",
    )
    named = sum(1 for r in rows if r["Name"].strip() not in NULL_SPELLINGS)
    if named < spec["min_named"]:
        raise SystemExit(
            f"{spec['name']}: only {named} named rows (< {spec['min_named']})"
        )
    by_id = {
        r[spec["id_column"]].strip(): {k: (v or "").strip() for k, v in r.items()}
        for r in rows
    }
    rl.validate_spot_rows(
        by_id, spec["spot_rows"],
        script_name=spec["name"], key_field=spec["id_column"],
        missing_hint="missing from the release — the catalogue was renumbered.",
    )
    print(f"  {spec['name']}: {len(rows)} rows, {named} named — gates green")


def write_atomic(out: Path, text: str) -> None:
    tmp = out.with_suffix(out.suffix + ".tmp")
    try:
        tmp.write_text(text, encoding="utf-8", newline="")
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    os.replace(tmp, out)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for spec in FILES:
        print(f"fetching {spec['url']}")
        text = fetch(spec["url"])
        validate(spec, text)
        out = OUT_DIR / spec["name"]
        write_atomic(out, text)
        print(f"  wrote {out}")
    print("Now re-run: pnpm run build:wgsn (and commit both if changed)")


if __name__ == "__main__":
    main()
