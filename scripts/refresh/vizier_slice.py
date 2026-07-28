#!/usr/bin/env python3
"""Declarative whole-table VizieR column slice → committed TSV. See
scripts/refresh/README.md § VizieR column slices."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))

import refresh_lib as rl  # noqa: E402

_MODULE_PATH = Path(__file__).resolve()


@dataclass(frozen=True)
class VizierSlice:
    """One VizieR table, a column subset, and the gates its pull must pass.

    ``columns`` maps the case-sensitive VizieR column name to the
    lowercase canonical TSV name downstream consumers read; the TSV column
    order follows this mapping's insertion order. ``schema`` is keyed on
    the VizieR names (it validates the query result, before renaming).

    ``spot_rows`` are ``rl.check_spot_row`` specs keyed on ``spot_key``, a
    VizieR column name — an absent pinned row hard-fails, so a table whose
    upstream selection narrows can't land silently.
    """

    table: str
    output: Path
    columns: Mapping[str, str]
    schema: Mapping[str, type | tuple[type, ...]]
    row_count_min: int
    row_count_max: int
    order_by: Sequence[str]
    spot_key: str
    spot_rows: Sequence[Mapping[str, Any]] = field(default_factory=tuple)
    round_floats: int | None = None

    @property
    def name(self) -> str:
        return self.output.stem

    @property
    def adql(self) -> str:
        cols = ", ".join(f'"{c}"' for c in self.columns)
        order = ", ".join(f'"{c}"' for c in self.order_by)
        return f'SELECT {cols} FROM "{self.table}" ORDER BY {order}'


def pull_slices(
    slices: Sequence[VizierSlice],
    *,
    script_name: str,
    sources: Sequence[Path],
    argv: Sequence[str],
    log: Callable[[str], None] = print,
    client: rl.TapClient | None = None,
) -> None:
    """Run every slice in ``slices``, or just the ``--only <name>`` one.

    ``sources`` need not list this module: its own mtime is folded in here
    the way ``rl.is_up_to_date`` folds in refresh_lib's, so a fix to the
    slice runner invalidates every caller's output.

    ``--force`` overrides the per-slice mtime skip. Each slice's output is
    written atomically by ``rl.write_tsv``, so a mid-pull failure on slice
    3 leaves slices 1–2 committed and slice 3 untouched — re-running
    resumes at the first stale output.

    VizieR's TAP default MAXREC is ~1e9, so whole-table slices need none of
    the MAXREC sizing the Gaia sync endpoints demand (README § Gaia TAP);
    the row-count gate is what catches an upstream row loss here.
    """
    force = "--force" in argv
    only = _only_arg(argv)
    if only is not None:
        known = [s.name for s in slices]
        if only not in known:
            raise SystemExit(
                f"{script_name}: --only {only!r} is not one of {known}"
            )
        slices = [s for s in slices if s.name == only]

    tap = client if client is not None else rl.TapClient(backends=[rl.cds_backend()])
    all_sources = [*sources, _MODULE_PATH]
    for sl in slices:
        _pull_one(
            sl, tap, script_name=script_name, sources=all_sources, force=force, log=log
        )


def _only_arg(argv: Sequence[str]) -> str | None:
    if "--only" not in argv:
        return None
    i = list(argv).index("--only")
    if i + 1 >= len(argv):
        raise SystemExit("--only needs a slice name (the output file's stem)")
    return argv[i + 1]


def _pull_one(
    sl: VizierSlice,
    tap: rl.TapClient,
    *,
    script_name: str,
    sources: Sequence[Path],
    force: bool,
    log: Callable[[str], None],
) -> None:
    label = f"{script_name}/{sl.name}"
    if not force and rl.is_up_to_date(sl.output, sources):
        log(f"{sl.output.name} up to date — skipping (use --force to rebuild)")
        return

    log(f'querying CDS TAP — "{sl.table}" ({len(sl.columns)} columns) …')
    t0 = time.time()
    table = tap.run(sl.adql)
    log(f"  {len(table)} rows in {time.time() - t0:.1f}s")

    rl.validate_schema(table, sl.schema, label=label)
    rl.assert_row_count(len(table), sl.row_count_min, sl.row_count_max, label)

    if sl.spot_rows:
        by_key = {}
        for row in table:
            key = rl.coerce_masked(row[sl.spot_key])
            if key is not None:
                by_key.setdefault(str(key), row)
        rl.validate_spot_rows(
            by_key,
            [{k: (str(v) if k == sl.spot_key else v) for k, v in spec.items()}
             for spec in sl.spot_rows],
            script_name=label,
            key_field=sl.spot_key,
            missing_hint=(
                "missing from query result — the upstream table's row "
                "selection or column set has changed."
            ),
        )

    rows = (
        {canonical: rl.coerce_masked(row[vizier])
         for vizier, canonical in sl.columns.items()}
        for row in table
    )
    written = rl.write_tsv(
        rows,
        columns=list(sl.columns.values()),
        output=sl.output,
        round_floats=sl.round_floats,
    )
    log(f"wrote {sl.output} ({written} rows)")
