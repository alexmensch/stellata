"""Snapshot assert / refresh for the Python build steps' count and rate
JSONs — sibling of snapshot-assert.ts. See scripts/util/README.md."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from scripts.util.paths import REPO_ROOT

UPDATE_COUNTS_ENV_VAR = "UPDATE_BUILD_COUNTS"


@dataclass
class SnapshotDiff:
    """One row of a snapshot diff. ``status`` is ``"match"``,
    ``"missing_actual"`` (key in expected but not in actual),
    ``"missing_expected"`` (key in actual but not in expected — typically
    a newly-introduced entry), or the snapshot-specific mismatch status
    (``"mismatch"`` for exact-match counts, ``"drift"`` for
    tolerance-checked rates). ``tolerance`` is populated only for the
    tolerance-checked snapshot; ``None`` for exact-match counts."""

    key: str
    status: str
    expected: float | None
    actual: float | None
    tolerance: float | None = None


def compare_snapshot(
    expected: dict[str, Any],
    actual: dict[str, float],
    *,
    expected_value: Callable[[Any], float],
    tolerance_of: Callable[[Any], float | None],
    matches: Callable[[float, float, float | None], bool],
    mismatch_status: str,
) -> list[SnapshotDiff]:
    """Per-key diff over the union of keys. ``expected_value`` /
    ``tolerance_of`` unwrap the expected payload (a bare int for counts, a
    ``{value, tolerance}`` dict for rates); ``matches`` decides
    ``"match"`` vs ``mismatch_status``."""
    out: list[SnapshotDiff] = []
    for key in sorted(expected.keys() | actual.keys()):
        if key not in actual:
            out.append(SnapshotDiff(
                key, "missing_actual",
                expected_value(expected[key]), None, tolerance_of(expected[key]),
            ))
        elif key not in expected:
            out.append(SnapshotDiff(key, "missing_expected", None, actual[key], None))
        else:
            ev = expected_value(expected[key])
            av = actual[key]
            tol = tolerance_of(expected[key])
            status = "match" if matches(ev, av, tol) else mismatch_status
            out.append(SnapshotDiff(key, status, ev, av, tol))
    return out


def format_diff(
    diff: list[SnapshotDiff],
    *,
    label: str,
    noun: str,
    ok_suffix: str,
    diff_verb: str,
    mismatch_status: str,
    render_mismatch: Callable[[SnapshotDiff], str],
    render_missing_actual: Callable[[SnapshotDiff], str],
    render_missing_expected: Callable[[SnapshotDiff], str],
) -> str:
    """A single match line when everything passes, otherwise the
    mismatches first, then removed and new keys. Per-row rendering is the
    caller's, so counts and rates format their own lines."""
    mismatches = [d for d in diff if d.status == mismatch_status]
    missing_actual = [d for d in diff if d.status == "missing_actual"]
    missing_expected = [d for d in diff if d.status == "missing_expected"]
    total_diffs = len(mismatches) + len(missing_actual) + len(missing_expected)
    if total_diffs == 0:
        return f"{label} {noun}: all {len(diff)} {ok_suffix}"
    lines = [f"{label} {noun}: {total_diffs} of {len(diff)} {diff_verb}"]
    lines += [render_mismatch(d) for d in mismatches]
    lines += [render_missing_actual(d) for d in missing_actual]
    lines += [render_missing_expected(d) for d in missing_expected]
    return "\n".join(lines)


def assert_or_update_snapshot(
    actual: dict[str, float],
    expected_path: Path,
    *,
    label: str,
    build_payload: Callable[[dict[str, float], Path], dict[str, Any]],
    compare: Callable[[dict[str, Any], dict[str, float]], list[SnapshotDiff]],
    format_diff: Callable[[list[SnapshotDiff]], str],
) -> bool:
    """True on a full match. Writes ``build_payload(actual, expected_path)``
    instead when ``UPDATE_BUILD_COUNTS=1`` is set or the snapshot is
    missing, and returns True."""
    should_update = os.environ.get(UPDATE_COUNTS_ENV_VAR) == "1"

    if should_update or not expected_path.exists():
        expected_path.write_text(json.dumps(build_payload(actual, expected_path), indent=2) + "\n")
        try:
            shown = expected_path.relative_to(REPO_ROOT)
        except ValueError:
            shown = expected_path
        print(f"[{label}] {'Updated' if should_update else 'Wrote initial'} {shown}")
        return True

    expected = json.loads(expected_path.read_text())
    diff = compare(expected, actual)
    print(f"[{label}] {format_diff(diff)}")
    return all(d.status == "match" for d in diff)


def compare_build_counts(
    expected: dict[str, int], actual: dict[str, int],
) -> list[SnapshotDiff]:
    """Exact-match per-key diff between two flat count dicts."""
    return compare_snapshot(
        expected, actual,
        expected_value=lambda e: e,
        tolerance_of=lambda e: None,
        matches=lambda ev, av, tol: ev == av,
        mismatch_status="mismatch",
    )


def format_count_diff(diff: list[SnapshotDiff], label: str) -> str:
    """Count-snapshot formatter — mismatches carry a signed int delta."""
    def mismatch(d: SnapshotDiff) -> str:
        delta = (d.actual or 0) - (d.expected or 0)
        sign = "+" if delta > 0 else ""
        return f"  {d.key:<40} expected {d.expected}, got {d.actual} ({sign}{delta})"

    return format_diff(
        diff,
        label=label,
        noun="counts", ok_suffix="counts match", diff_verb="counts differ",
        mismatch_status="mismatch",
        render_mismatch=mismatch,
        render_missing_actual=lambda d: f"  {d.key:<40} expected {d.expected}, missing in actual",
        render_missing_expected=lambda d: f"  {d.key:<40} new key, got {d.actual} (no snapshot)",
    )


def assert_or_update_counts(actual: dict[str, int], expected_path: Path, label: str) -> bool:
    """Exact-match snapshot assert/refresh for an int-count JSON."""
    return assert_or_update_snapshot(
        actual, expected_path,
        label=label,
        build_payload=lambda a, _path: a,
        compare=compare_build_counts,
        format_diff=lambda diff: format_count_diff(diff, label),
    )
