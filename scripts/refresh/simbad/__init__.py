"""Reusable SIMBAD-pull plumbing — specs, inputs (membership feeders), request
(oid resolution + corroboration), query (ADQL + batched executors), union
(the value-keyed pass), coverage (fill gates), tsv (writer)."""

from pathlib import Path


def source_files() -> list[Path]:
    """Every module in this package, for a shell's `is_up_to_date` source
    list — editing the plumbing has to invalidate the pulls it drives."""
    return sorted(
        p for p in Path(__file__).resolve().parent.glob("*.py")
        if not p.name.endswith(".test.py")
    )
