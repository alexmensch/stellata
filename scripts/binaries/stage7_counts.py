#!/usr/bin/env python3
"""Stage 7 — flatten per-strategy / per-tier counters into a snapshot
JSON the build asserts against on every run.

Mirrors ``scripts/catalog/build-catalog.ts``'s ``assertOrUpdateBuildCounts``
flow — refresh deliberately with ``UPDATE_BUILD_COUNTS=1``.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parsers import WdsPair  # noqa: E402
from stage2_resolve import (  # noqa: E402
    RESOLVE_VIA_VALUES,
    ResolvedComponent,
    resolution_counts,
)
from stage3_astrometry import (  # noqa: E402
    ASTROMETRY_VIA_VALUES,
    ComponentAstrometry,
    astrometry_counts,
)
from stage4_orbits import (  # noqa: E402
    ORBIT_VIA_VALUES,
    OrbitElements,
    orbit_counts,
)
from stage5_optical import (  # noqa: E402
    OPTICAL_VIA_VALUES,
    OpticalClassification,
    optical_counts,
)
from stage6_multiples import (  # noqa: E402
    ASTROMETRY_VIA_SYSTEM_INHERITED, ORBIT_ROLE_STANDALONE,
    SPECT_VIA_VALUES, MultiplesRow,
)

# Stage 7 logs from inside ``assert_or_update_counts``; defining a
# local ``log`` keeps the module standalone (no back-import from
# build-binaries.py). ``ROOT`` is the repo root so log lines can show
# the snapshot path relative to it.
ROOT = Path(__file__).resolve().parent.parent.parent


def log(msg: str) -> None:
    print(f"[build-binaries] {msg}")


# ─── Stage 7: build-time stats ───────────────────────────────────────


# Environment variable that flips the counts snapshot from compare
# mode (the default) to write-or-overwrite. Shared with
# ``build-catalog.ts`` so a single refresh command updates both
# snapshots when the pipeline shifts.
UPDATE_COUNTS_ENV_VAR = "UPDATE_BUILD_COUNTS"


def build_binaries_counts(
    *,
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    astrometry: list[ComponentAstrometry],
    orbits: list[tuple[OrbitElements | None, str]],
    classifications: list[OpticalClassification],
    multiples_rows: list[MultiplesRow],
) -> dict[str, int]:
    """Collect every headline number the run emits into a flat
    ``{key: int}`` dict, suitable for JSON serialisation and per-key
    comparison. Keys flatten the per-strategy + per-tier counters via
    ``<section>_<tag>`` so the JSON stays grep-friendly and the
    snapshot diff is a flat dict-diff.

    Decomposing-pair count is the number of WDS pairs whose components
    string split into two; aligns with ``len(orbits) ==
    len(classifications)``.
    """
    res = resolution_counts(components)
    ast = astrometry_counts(astrometry)
    orb = orbit_counts(orbits)
    opt = optical_counts(classifications)

    # Per-component spect provenance via the row's ``spect_via`` tag
    # (mirrors the per-section ``_via`` counters below).
    spect_counts: dict[str, int] = {tag: 0 for tag in SPECT_VIA_VALUES}
    for r in multiples_rows:
        spect_counts[r.spect_via] = spect_counts.get(r.spect_via, 0) + 1

    # Count system-anchor-inherited positions and standalone
    # (per-component augmentation) rows directly off the emitted
    # multiples list so the snapshot diff catches drift in either
    # tier independently of Stage 3's per-component counts.
    multiples_inherited = sum(
        1 for r in multiples_rows
        if r.astrometry_via == ASTROMETRY_VIA_SYSTEM_INHERITED
    )
    standalone_emitted = sum(
        1 for r in multiples_rows
        if r.orbit_role == ORBIT_ROLE_STANDALONE
    )

    out: dict[str, int] = {
        "wds_pairs_total": len(pairs),
        "decomposing_pairs": len(orbits),
        "components_total": len(components),
        "multiples_rows_emitted": len(multiples_rows),
        "multiples_astrometry_system_inherited": multiples_inherited,
        "multiples_standalone_emitted": standalone_emitted,
    }
    for tag in SPECT_VIA_VALUES:
        out[f"spect_{tag}"] = spect_counts[tag]
    for tag in RESOLVE_VIA_VALUES:
        out[f"resolution_{tag}"] = res[tag]
    for tag in ASTROMETRY_VIA_VALUES:
        out[f"astrometry_{tag}"] = ast[tag]
    for tag in ORBIT_VIA_VALUES:
        out[f"orbit_{tag}"] = orb[tag]
    for tag in OPTICAL_VIA_VALUES:
        out[f"optical_{tag}"] = opt[tag]
    return out


@dataclass
class CountDiff:
    """One row of the snapshot diff. ``status`` is ``"match"``,
    ``"mismatch"``, ``"missing_actual"`` (key in expected but not in
    actual), or ``"missing_expected"`` (key in actual but not in
    expected — typically a newly-introduced counter)."""

    key: str
    status: str
    expected: int | None
    actual: int | None


def compare_build_counts(
    expected: dict[str, int], actual: dict[str, int],
) -> list[CountDiff]:
    """Per-key diff between two flat count dicts. The union of keys is
    walked so newly-added or newly-removed counters surface explicitly
    rather than disappearing into the matched set."""
    out: list[CountDiff] = []
    for key in sorted(expected.keys() | actual.keys()):
        e = expected.get(key)
        a = actual.get(key)
        if key not in actual:
            out.append(CountDiff(key, "missing_actual", e, None))
        elif key not in expected:
            out.append(CountDiff(key, "missing_expected", None, a))
        elif e == a:
            out.append(CountDiff(key, "match", e, a))
        else:
            out.append(CountDiff(key, "mismatch", e, a))
    return out


def format_count_diff(diff: list[CountDiff]) -> str:
    """Pretty-printer matching ``build-counts.ts``'s ``formatCountDiff``
    shape — single match line when everything passes, otherwise the
    mismatches listed first (each with signed delta), then any new /
    removed keys."""
    mismatches = [d for d in diff if d.status == "mismatch"]
    missing_actual = [d for d in diff if d.status == "missing_actual"]
    missing_expected = [d for d in diff if d.status == "missing_expected"]
    total_diffs = len(mismatches) + len(missing_actual) + len(missing_expected)
    lines: list[str] = []
    if total_diffs == 0:
        lines.append(f"build-binaries counts: all {len(diff)} counts match")
        return "\n".join(lines)
    lines.append(
        f"build-binaries counts: {total_diffs} of {len(diff)} counts differ"
    )
    for m in mismatches:
        delta = (m.actual or 0) - (m.expected or 0)
        sign = "+" if delta > 0 else ""
        lines.append(
            f"  {m.key:<40} expected {m.expected}, got {m.actual} ({sign}{delta})"
        )
    for m in missing_actual:
        lines.append(f"  {m.key:<40} expected {m.expected}, missing in actual")
    for m in missing_expected:
        lines.append(f"  {m.key:<40} new key, got {m.actual} (no snapshot)")
    return "\n".join(lines)


def assert_or_update_counts(actual: dict[str, int], expected_path: Path) -> bool:
    """Compare ``actual`` against the committed snapshot at
    ``expected_path``. Returns ``True`` on full match, ``False``
    otherwise. Side effect: when the env var ``UPDATE_BUILD_COUNTS=1``
    is set OR the snapshot file is missing, write ``actual`` to disk
    and return ``True``.

    Mirrors ``build-catalog.ts``'s ``assertOrUpdateBuildCounts`` so a
    single ``UPDATE_BUILD_COUNTS=1`` refresh covers both the TS and
    Python sides of the pipeline.
    """
    should_update = os.environ.get(UPDATE_COUNTS_ENV_VAR) == "1"

    if should_update or not expected_path.exists():
        expected_path.write_text(json.dumps(actual, indent=2) + "\n")
        try:
            shown = expected_path.relative_to(ROOT)
        except ValueError:
            shown = expected_path
        log(
            f"{'Updated' if should_update else 'Wrote initial'} {shown}"
        )
        return True

    expected = json.loads(expected_path.read_text())
    diff = compare_build_counts(expected, actual)
    report = format_count_diff(diff)
    log(report)
    return all(d.status == "match" for d in diff)


# ─── Driver ──────────────────────────────────────────────────────────

