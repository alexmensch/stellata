"""Load data/simbad/wds_xids_overrides.tsv — hand-curated SIMBAD oid
overrides for WDS components the Phase A `WDS J<id><comp>` ident lookup
misses. See the TSV's header block for the schema."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable


HEADER_COLUMNS = ("wds_id", "component", "simbad_oid", "reason")


def load_overrides(path: Path) -> dict[tuple[str, str], int]:
    """Return ``{(wds_id, component): simbad_oid}`` from the overrides TSV.

    Skips ``#``-comment and empty lines. Verifies the first non-blank
    non-comment row matches HEADER_COLUMNS exactly. Returns an empty dict
    if the file is absent so a missing overrides file is a no-op rather
    than a hard failure (matches the script's existing tolerance for
    optional data files).

    Raises ValueError on:
    - malformed header (column count or names),
    - row with the wrong number of fields,
    - non-integer simbad_oid,
    - duplicate (wds_id, component) keys (silent override loss is the
      whole reason this file exists, so we surface the conflict instead
      of accepting last-write-wins).
    """
    if not path.exists():
        return {}
    overrides: dict[tuple[str, str], int] = {}
    seen_header = False
    with path.open("r", encoding="utf-8") as f:
        for line_no, raw in enumerate(f, start=1):
            line = raw.rstrip("\r\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            fields = line.split("\t")
            if not seen_header:
                if tuple(fields) != HEADER_COLUMNS:
                    raise ValueError(
                        f"{path}: header mismatch at line {line_no}: "
                        f"got {fields!r}, expected {list(HEADER_COLUMNS)!r}"
                    )
                seen_header = True
                continue
            if len(fields) != len(HEADER_COLUMNS):
                raise ValueError(
                    f"{path}: line {line_no} has {len(fields)} fields, "
                    f"expected {len(HEADER_COLUMNS)}"
                )
            wds_id, component, oid_str, _reason = fields
            try:
                oid = int(oid_str)
            except ValueError as e:
                raise ValueError(
                    f"{path}: line {line_no} simbad_oid {oid_str!r} is not an integer"
                ) from e
            key = (wds_id, component)
            if key in overrides:
                raise ValueError(
                    f"{path}: line {line_no} duplicate override for {key!r} "
                    f"(previous oid {overrides[key]}, new oid {oid})"
                )
            overrides[key] = oid
    return overrides


def validate_against_components(
    overrides: dict[tuple[str, str], int],
    components: Iterable[tuple[str, str]],
) -> None:
    """Ensure every override row references a (wds_id, component) tuple that
    the WDS catalog actually enumerates — otherwise downstream Stage 2 has
    no host pair to attach the resolution to, and the row would be silently
    dropped during composition.

    Raises ValueError listing every orphaned override key."""
    component_set = set(components)
    orphans = sorted(k for k in overrides if k not in component_set)
    if orphans:
        raise ValueError(
            "wds_xids_overrides.tsv references (wds_id, component) tuples "
            "absent from the WDS summary catalog — Stage 2 has no host pair "
            f"for these rows: {orphans}"
        )
