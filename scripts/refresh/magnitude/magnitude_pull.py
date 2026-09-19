#!/usr/bin/env python3
"""The magnitude-bounded selection and the two-leg deep-population pull
built on it. See scripts/refresh/magnitude/README.md."""

from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any, Callable, Mapping, NamedTuple, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import refresh_lib as rl  # noqa: E402

# Callers pass this to is_up_to_date — see magnitude/README.md
MODULE_PATH = Path(__file__).resolve()

# ─── The magnitude-bounded selection ──────────────────────────────────

G_MAG_FLOOR = 11.0

G_MAG_COLUMN = "phot_g_mean_mag"

SOURCES_PER_MAGNITUDE = 2.48

SLICE_COUNT = 48

EDGE_DECIMALS = 6

MagnitudeSlice = tuple[str | None, str]


def magnitude_slices(
    floor: float = G_MAG_FLOOR,
    count: int = SLICE_COUNT,
    ratio: float = SOURCES_PER_MAGNITUDE,
) -> list[MagnitudeSlice]:
    """The selection's `(lo, hi)` magnitude bounds as formatted ADQL
    literals, brightest slice first. `lo` is None on the first slice alone,
    which is open at the bright end so a source brighter than any edge
    cannot fall outside the pull.

    Consecutive slices share one edge STRING, so the bounds partition the
    range exactly: no source can satisfy both `> e` and `<= e`, and none
    can satisfy neither.
    """
    edges = [
        f"{floor + math.log(k / count) / math.log(ratio):.{EDGE_DECIMALS}f}"
        for k in range(1, count + 1)
    ]
    return list(zip([None, *edges[:-1]], edges))


def magnitude_predicate(bounds: MagnitudeSlice, column: str) -> str:
    """One slice as an ADQL predicate on `column`, which a joined pull
    qualifies with its own alias."""
    lo, hi = bounds
    where = f"{column} <= {hi}"
    return where if lo is None else f"{column} > {lo} AND {where}"


SLICE_MAXREC_HEADROOM = 4


def slice_sync_maxrec(
    expected_row_count_max: int,
    *,
    count: int = SLICE_COUNT,
    headroom: int = SLICE_MAXREC_HEADROOM,
) -> int:
    """MAXREC for one slice of a magnitude-partitioned pull: `headroom`
    times the nominal slice population. The factor is margin against the
    magnitude distribution moving, not against the slices being uneven —
    `magnitude_slices` already holds those within ~5% of each other.

    A slice count is not a batch size, so `run_in_batches`' `BATCH_SIZE * 2`
    rule has nothing to multiply here; every pull that slices on magnitude
    sizes its cap this way.
    """
    return headroom * (expected_row_count_max // count)


def assert_partitioned(returned: int, unique: int, script_name: str) -> None:
    """No source returned by more than one slice. Takes the two counts
    rather than the ids: at seven figures the caller already holds whichever
    of a list or a set it needs, and materialising the other doubles the
    pull's peak memory for one comparison.
    """
    if returned != unique:
        raise SystemExit(
            f"{script_name}: {returned - unique} source_ids returned by more "
            f"than one slice — the slice edges overlap; see "
            f"magnitude_pull.magnitude_slices."
        )


# ─── The deep population: a bounded leg plus a request leg ────────────

GAIA_SOURCE_TABLE = "gaiadr3.gaia_source"

ID_BATCH_SIZE = 5_000

_MAGNITUDE_ALIAS = "t"
_GAIA_SOURCE_ALIAS = "g"


def magnitude_leg_adql(
    columns: Sequence[str], table: str, bounds: MagnitudeSlice
) -> str:
    """One slice of `table` restricted to the sources the magnitude bound
    admits. The bound lives on `gaia_source`, so reaching it takes a join;
    both tables are keyed on `source_id`, which is indexed, so the join
    costs about as much as the slice itself.

    The projection is alias-qualified but unrenamed, so both legs hand
    `collect` the same column names.
    """
    t, g = _MAGNITUDE_ALIAS, _GAIA_SOURCE_ALIAS
    projection = ", ".join(f"{t}.{column}" for column in columns)
    return (
        f"SELECT {projection} FROM {table} AS {t} "
        f"JOIN {GAIA_SOURCE_TABLE} AS {g} ON {g}.source_id = {t}.source_id "
        f"WHERE {magnitude_predicate(bounds, f'{g}.{G_MAG_COLUMN}')}"
    )


def request_leg_adql(
    columns: Sequence[str], table: str, ids: Sequence[int]
) -> str:
    inlist = ",".join(str(i) for i in ids)
    return (
        f"SELECT {', '.join(columns)} FROM {table} "
        f"WHERE source_id IN ({inlist})"
    )


class DeepPopulation(NamedTuple):
    """What `pull_deep_population` reached. `matched_request` is the share
    of the request set either leg served — the number a caller gates on.
    """

    seen: set[int]
    from_magnitude: int
    requested: int
    matched_request: int


def pull_deep_population(
    client: rl.TapClient,
    *,
    table: str,
    columns: Sequence[str],
    request_path: Path,
    on_row: Callable[[Any], None],
    script_name: str,
    maxrec: int,
    checkpoint_base: Path,
    schema: Mapping[str, type | tuple[type, ...]] | None = None,
    schema_label: str = "batch",
    batch_size: int = ID_BATCH_SIZE,
    log: Callable[[str], None] = print,
) -> DeepPopulation:
    """Every `table` row for the catalogue's deep population, handed to
    `on_row` exactly once per source_id.

    Two legs, because the population has two definitions and neither
    contains the other. The magnitude leg is a SELECTION — every source at
    `G_MAG_FLOOR` or brighter, which no request set names because nothing
    binds them yet. The request leg is `request_path`'s source_ids, whose
    classic tiers reach fainter than the floor. Restricting the request leg
    to the ids the magnitude leg did not return is what keeps it to the
    genuine remainder, and is also what makes `on_row` a once-per-source
    contract the caller can write straight to a line.

    Reading the request file, reporting both legs and counting the request
    set's coverage all live here so a calling script is its gates and
    nothing else.
    """
    request_ids = rl.read_source_id_request(request_path)
    if not request_ids:
        raise SystemExit(f"{script_name}: no source_ids in {request_path}")

    slices = magnitude_slices()
    log(
        f"pulling {table} over the deep population: {len(slices)} magnitude "
        f"slices at G <= {G_MAG_FLOOR} plus what {len(request_ids):,} requested "
        f"source_ids add (MAXREC {maxrec:,})"
    )

    seen: set[int] = set()
    returned = 0

    def collect(table_result: Any) -> None:
        nonlocal returned
        for row in table_result:
            returned += 1
            source_id = int(row["source_id"])
            seen.add(source_id)
            on_row(row)

    rl.run_in_batches(
        slices, 1,
        lambda batch: client.run(magnitude_leg_adql(columns, table, batch[0])),
        collect,
        schema=schema, schema_label=schema_label,
        checkpoint=rl.BatchCheckpoint(_leg_checkpoint(checkpoint_base, "magnitude")),
        log=log,
    )
    assert_partitioned(returned, len(seen), script_name)
    from_magnitude = len(seen)

    remainder = [sid for sid in request_ids if sid not in seen]
    log(
        f"  request leg: {len(remainder):,} of {len(request_ids):,} requested "
        f"source_ids the magnitude leg did not reach"
    )
    rl.run_in_batches(
        remainder, batch_size,
        lambda batch: client.run(request_leg_adql(columns, table, batch)),
        collect,
        schema=schema, schema_label=schema_label,
        checkpoint=rl.BatchCheckpoint(_leg_checkpoint(checkpoint_base, "request")),
        log=log,
    )

    matched_request = sum(1 for sid in request_ids if sid in seen)
    log(
        f"  magnitude leg     {from_magnitude:>9,}\n"
        f"  request leg adds  {len(seen) - from_magnitude:>9,}\n"
        f"  of {len(request_ids):,} requested source_ids: {matched_request:,} "
        f"({100 * matched_request / len(request_ids):.1f}%)"
    )
    return DeepPopulation(seen, from_magnitude, len(request_ids), matched_request)


def assert_request_coverage(
    result: DeepPopulation, floor: float, script_name: str
) -> float:
    """Gate the share of the request set the pull served. The magnitude leg
    is gated by its own row-count band, which says nothing about the request
    leg — so without this a request leg that returned nothing still passes
    every other check, and the promoted companions the union exists to reach
    go missing until a downstream shortfall pin notices.
    """
    coverage = result.matched_request / result.requested
    if coverage < floor:
        raise SystemExit(
            f"{script_name}: coverage {coverage:.1%} of the request set is "
            f"below floor {floor:.0%} — the catalogue's source_ids or the "
            f"upstream table has changed; investigate before re-pinning."
        )
    return coverage


def _leg_checkpoint(base: Path, leg: str) -> Path:
    """One cache directory per leg. They must not collide: a resumed run
    replays a leg's cached batches, and a shared directory would feed the
    magnitude leg's results back as the request leg's.
    """
    return base.with_suffix(f"{base.suffix}.ckpt-{leg}")

