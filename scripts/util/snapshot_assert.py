"""Snapshot assert / refresh for the Python build steps' count and rate
JSONs — sibling of snapshot-check.ts. See scripts/util/README.md."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from scripts.util.paths import REPO_ROOT

UPDATE_SNAPSHOTS_ENV_VAR = "UPDATE_SNAPSHOTS"
PIPELINE_STEP_ENV_VAR = "PIPELINE_STEP"


def refresh_command(script: str) -> str:
    if PIPELINE_STEP_ENV_VAR in os.environ:
        return f"pnpm run {script} --update-snapshots"
    return f"{UPDATE_SNAPSHOTS_ENV_VAR}=1 pnpm run {script}"


STAGES_KEY = "stages"

Staged = dict[str, dict[str, Any]]
"""Stage → count → value, stages in pipeline order: what a build step
hands the snapshot, each count written inside the block of the stage that
computes it."""


def flatten_staged(staged: Staged) -> dict[str, Any]:
    """Every count of ``staged`` with its stage level dropped; a key two
    stages share raises."""
    return flatten_stages({STAGES_KEY: staged})


def stage_of_counts(payload: Any) -> dict[str, str] | None:
    """Each count's stage in a staged snapshot; None for any other payload."""
    if not _is_staged(payload):
        return None
    return {key: stage for stage, counts in payload[STAGES_KEY].items() for key in counts}


def _is_staged(payload: Any) -> bool:
    return (
        isinstance(payload, dict) and list(payload) == [STAGES_KEY]
        and isinstance(payload[STAGES_KEY], dict)
    )


def flatten_stages(payload: Any) -> Any:
    """A staged snapshot with its stage level dropped; any other payload
    as it is. A key two stages share raises."""
    if not _is_staged(payload):
        return payload
    flat: dict[str, Any] = {}
    owner: dict[str, str] = {}
    for stage, counts in payload[STAGES_KEY].items():
        for key, value in counts.items():
            if key in owner:
                raise ValueError(f"count {key} is under two stages, {owner[key]} and {stage}")
            owner[key] = stage
            flat[key] = value
    return flat


@dataclass
class SnapshotDiff:
    """One row of a snapshot diff. ``status`` is ``"match"``,
    ``"missing_actual"`` (key in expected but not in actual),
    ``"missing_expected"`` (key in actual but not in expected — typically
    a newly-introduced entry), ``"moved"`` (a matching value filed under
    another stage, ``moved`` naming the two), or the snapshot-specific
    mismatch status (``"mismatch"`` for exact-match counts, ``"drift"`` for
    tolerance-checked rates). ``tolerance`` is populated only for the
    tolerance-checked snapshot; ``None`` for exact-match counts."""

    key: str
    status: str
    expected: float | None
    actual: float | None
    tolerance: float | None = None
    moved: tuple[str, str] | None = None


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
    mismatches first, then removed, new and moved keys. Per-row rendering
    is the caller's, so counts and rates format their own lines."""
    mismatches = [d for d in diff if d.status == mismatch_status]
    missing_actual = [d for d in diff if d.status == "missing_actual"]
    missing_expected = [d for d in diff if d.status == "missing_expected"]
    moved = [d for d in diff if d.status == "moved"]
    total_diffs = len(mismatches) + len(missing_actual) + len(missing_expected) + len(moved)
    if total_diffs == 0:
        return f"{label} {noun}: all {len(diff)} {ok_suffix}"
    lines = [f"{label} {noun}: {total_diffs} of {len(diff)} {diff_verb}"]
    lines += [render_mismatch(d) for d in mismatches]
    lines += [render_missing_actual(d) for d in missing_actual]
    lines += [render_missing_expected(d) for d in missing_expected]
    lines += [f"  {d.key:<40} moved from stage {d.moved[0]} to {d.moved[1]}" for d in moved if d.moved]
    return "\n".join(lines)


def assert_or_update_snapshot(
    actual: Staged,
    expected_path: Path,
    *,
    label: str,
    script: str,
    build_payload: Callable[[dict[str, float], Path], dict[str, Any]],
    compare: Callable[[dict[str, Any], dict[str, float]], list[SnapshotDiff]],
    render: Callable[[list[SnapshotDiff]], str],
) -> bool:
    """True on a full match; False on drift or a missing snapshot, after
    printing how to refresh it through ``script``. Under ``UPDATE_SNAPSHOTS=1`` writes
    the staged snapshot instead, each stage's block through
    ``build_payload(counts, expected_path)`` and a stage with no counts left
    out, and returns True. ``compare`` sees both sides flattened; a count it
    matches that sits under another stage than the snapshot's is ``moved``."""
    try:
        shown = expected_path.relative_to(REPO_ROOT)
    except ValueError:
        shown = expected_path

    if os.environ.get(UPDATE_SNAPSHOTS_ENV_VAR) == "1":
        payload = {STAGES_KEY: {
            stage: build_payload(counts, expected_path)
            for stage, counts in actual.items() if counts
        }}
        expected_path.write_text(json.dumps(payload, indent=2) + "\n")
        print(f"[{label}] Updated {shown}")
        return True

    if not expected_path.exists():
        print(f"[{label}] snapshot {shown} is missing. To write it:\n  {refresh_command(script)}")
        return False

    committed = json.loads(expected_path.read_text())
    diff = _with_moves(
        compare(flatten_stages(committed), flatten_staged(actual)),
        stage_of_counts(committed),
        stage_of_counts({STAGES_KEY: actual}) or {},
    )
    print(f"[{label}] {render(diff)}")
    if all(d.status == "match" for d in diff):
        return True
    print(
        f"[{label}] {shown} assertion failed. If the change is intentional, "
        f"refresh the snapshot with: {refresh_command(script)}"
    )
    return False


def _with_moves(
    diff: list[SnapshotDiff], committed: dict[str, str] | None, built: dict[str, str],
) -> list[SnapshotDiff]:
    if committed is None:
        return diff
    for d in diff:
        was, now = committed.get(d.key), built.get(d.key)
        if d.status == "match" and was is not None and now is not None and was != now:
            d.status, d.moved = "moved", (was, now)
    return diff


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


def assert_or_update_counts(
    actual: Staged, expected_path: Path, *, label: str, script: str,
) -> bool:
    """Exact-match snapshot assert/refresh for an int-count JSON."""
    return assert_or_update_snapshot(
        actual, expected_path,
        label=label,
        script=script,
        build_payload=lambda a, _path: a,
        compare=compare_build_counts,
        render=lambda diff: format_count_diff(diff, label),
    )
