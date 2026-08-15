"""Reusable SIMBAD-pull plumbing — specs (ColumnSpec / IdentLookup),
inputs (spine feeders), request (oid resolution), query (ADQL builders +
batched executors), coverage (fill gates), tsv (spec-driven writer)."""

from pathlib import Path


def source_files() -> list[Path]:
    """Every module in this package, for a shell's `is_up_to_date` source
    list — editing the plumbing has to invalidate the pulls it drives."""
    return sorted(
        p for p in Path(__file__).resolve().parent.glob("*.py")
        if not p.name.endswith(".test.py")
    )
