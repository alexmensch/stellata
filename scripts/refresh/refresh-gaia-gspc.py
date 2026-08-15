#!/usr/bin/env python3
"""Refresh data/gaia/gaia_dr3_gspc.tsv — Gaia DR3 synthetic photometry
(GSPC) Johnson-Kron-Cousins B and V per catalog source_id."""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

import refresh_lib as rl  # noqa: E402
from paths import REPO_ROOT  # noqa: E402

ROOT = REPO_ROOT
REQUEST = ROOT / "data" / "gaia" / "gaia_catalog_source_id_request.tsv"
OUT = ROOT / "data" / "gaia" / "gaia_dr3_gspc.tsv"

TSV_COLUMNS = [
    "source_id",
    "b_jkc_mag",
    "b_jkc_flux",
    "b_jkc_flux_error",
    "b_jkc_flag",
    "v_jkc_mag",
    "v_jkc_flux",
    "v_jkc_flux_error",
    "v_jkc_flag",
]

# The `*_flux_error` columns are absolute fluxes in W nm-1 m-2, so a
# consumer needs `*_flux` beside them to form the relative error the
# magnitude uncertainty is proportional to. Pulling the flux is what makes
# the error column readable at all.
FLUX_COLUMNS: frozenset[str] = frozenset(
    {"b_jkc_flux", "b_jkc_flux_error", "v_jkc_flux", "v_jkc_flux_error"}
)
FLAG_COLUMNS: tuple[str, str] = ("b_jkc_flag", "v_jkc_flag")

ADQL_TEMPLATE = (
    "SELECT " + ", ".join(TSV_COLUMNS) + " "
    "FROM gaiadr3.synthetic_photometry_gspc "
    "WHERE source_id IN ({inlist})"
)

# Upstream dtypes (live probe 2026-08-15): int64 source_id, float32
# magnitudes and fluxes, int16 flags. validate_schema maps `float` to
# np.floating and `int` to np.integer, so the narrower widths pass.
EXPECTED_SCHEMA: dict[str, type | tuple[type, ...]] = {
    "source_id": int,
    "b_jkc_mag": float,
    "b_jkc_flux": float,
    "b_jkc_flux_error": float,
    "b_jkc_flag": int,
    "v_jkc_mag": float,
    "v_jkc_flux": float,
    "v_jkc_flux_error": float,
    "v_jkc_flag": int,
}

# 5000 ids per IN-clause — the same empirical sweet spot the other
# source_id-keyed Gaia pulls use.
BATCH_SIZE = 5_000

# GSPC exists only for sources with published BP/RP mean spectra, and it
# drops the hot-blue and very-red bright ends of this catalogue entirely
# (probe 2026-08-15: 4,378 rows over a 5,000-id stratified sample =
# 87.6%). 312,654 request ids therefore project to ~274k rows.
EXPECTED_ROW_COUNT_MIN = 255_000
EXPECTED_ROW_COUNT_MAX = 300_000

# Presence floor over the request set, ~8 pts below the probed 87.6% so a
# DR-side re-issue that trims the XP-spectra population does not
# false-fail. A real regression shows up an order of magnitude below this.
EXPECTED_COVERAGE_MIN = 0.80

# Magnitudes are float32 (~7 significant digits); 6 decimals is the same
# width the broadband magnitudes are written at. Fluxes span ~1e-19 W
# nm-1 m-2 and need an exponent, so they are written in scientific
# notation at float32's full precision rather than rounded to a fixed
# number of decimal places.
MAG_DECIMALS = 6
FLUX_SIG_FIGS = 8

# Self-consistency spot-checks pinned from the live ESA archive on
# 2026-08-15, chosen to span the flag's validated-range boundary in both
# directions and to pin the flag polarity itself (Montegriffo+ 2023 § 6.2
# defines it; data/gaia/README.md § The GSPC validated-range flag carries
# the quote and the measured region):
#
#   - IN_RANGE     : G 11.05, BP-RP 0.85 — inside the validated box, both
#                    flags 1, both bands present.
#   - SPLIT_BANDS  : G 11.56, BP-RP 1.09 — V present and flag 1, B absent
#                    with flag 0. The per-band-null shape, which a
#                    both-bands-or-nothing assumption would silently pass.
#   - RED_OUT      : Barnard's Star, G 8.19, BP-RP 2.80 — bright and red,
#                    both flags 0. This is the shape the whole bright
#                    catalogue takes, so a polarity flip upstream lands
#                    here first.
SPOT_CHECKS: list[dict[str, Any]] = [
    {
        "source_id":        36747057287093632,   # IN_RANGE
        "b_jkc_mag":        (11.890008, 0.0001),
        "b_jkc_flag":       (1, 0),
        "v_jkc_mag":        (11.224282, 0.0001),
        "v_jkc_flag":       (1, 0),
    },
    {
        "source_id":        10625474212633728,   # SPLIT_BANDS
        "b_jkc_mag":        None,
        "b_jkc_flag":       (0, 0),
        "v_jkc_mag":        (11.702773, 0.0001),
        "v_jkc_flag":       (1, 0),
    },
    {
        "source_id":        4472832130942575872,  # RED_OUT — Barnard's Star
        "b_jkc_mag":        (11.249152, 0.0001),
        "b_jkc_flag":       (0, 0),
        "v_jkc_mag":        (9.555117, 0.0001),
        "v_jkc_flag":       (0, 0),
    },
]

SCRIPT_NAME = "refresh-gaia-gspc"


def query_batch(client: rl.TapClient, ids: list[int]):
    inlist = ",".join(str(i) for i in ids)
    return client.run(ADQL_TEMPLATE.format(inlist=inlist))


def _band_present(row: Any, band: str) -> bool:
    return rl.coerce_masked(row[f"{band}_jkc_mag"]) is not None


def _both_bands_present(row: Any) -> bool:
    return _band_present(row, "b") and _band_present(row, "v")


def _both_flags_valid(row: Any) -> bool:
    return all(rl.coerce_masked(row[col]) == 1 for col in FLAG_COLUMNS)


def write_row(row: Any) -> dict[str, Any]:
    """Build one output dict — coerce_masked every cell, pre-format so
    write_tsv emits stable widths. Magnitudes round to MAG_DECIMALS;
    fluxes keep float32's precision in scientific notation; flags stay
    integers."""
    out: dict[str, Any] = {"source_id": int(row["source_id"])}
    for col in TSV_COLUMNS[1:]:
        v = rl.coerce_masked(row[col])
        if v is None:
            out[col] = None
        elif col in FLAG_COLUMNS:
            out[col] = int(v)
        elif col in FLUX_COLUMNS:
            out[col] = f"{float(v):.{FLUX_SIG_FIGS}e}"
        else:
            out[col] = f"{float(v):.{MAG_DECIMALS}f}"
    return out


def assert_flag_domain(rows: list[Any]) -> None:
    """The flags are a two-valued domain in DR3. A third value would mean
    the column changed meaning, and every consumer's validated-range gate
    would silently re-partition."""
    seen: set[int] = set()
    for row in rows:
        for col in FLAG_COLUMNS:
            v = rl.coerce_masked(row[col])
            if v is not None:
                seen.add(int(v))
    unexpected = seen - {0, 1}
    if unexpected:
        raise SystemExit(
            f"{SCRIPT_NAME}: flag columns carry unexpected values "
            f"{sorted(unexpected)} — DR3 publishes 0/1 only; the "
            f"validated-range gate downstream assumes that domain."
        )


def main() -> None:
    force = "--force" in sys.argv

    if not force and rl.is_up_to_date(OUT, [Path(__file__), REQUEST]):
        print(f"{OUT.relative_to(ROOT)} up to date — skipping (use --force to rebuild)")
        return

    if not REQUEST.exists():
        raise SystemExit(
            f"{SCRIPT_NAME}: request file {REQUEST.relative_to(ROOT)} is missing "
            f"— run `pnpm run build:astrometry-request` first."
        )

    source_ids = rl.read_source_id_request(REQUEST)
    total = len(source_ids)
    if total == 0:
        raise SystemExit(f"{SCRIPT_NAME}: no source_ids in {REQUEST.relative_to(ROOT)}")
    n_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
    print(
        f"reading {total} source_ids → {n_batches} batches of "
        f"{BATCH_SIZE} on Gaia TAP (gaiadr3.synthetic_photometry_gspc)"
    )

    client = rl.gaia_sync_client(BATCH_SIZE * 2)
    rows_by_id: dict[int, Any] = {}

    def collect(table: Any) -> None:
        for row in table:
            rows_by_id[int(row["source_id"])] = row

    start = time.time()
    rl.run_in_batches(
        source_ids, BATCH_SIZE, lambda b: query_batch(client, b), collect,
        schema=EXPECTED_SCHEMA, schema_label="gaiadr3.synthetic_photometry_gspc",
        checkpoint=rl.BatchCheckpoint(OUT.with_suffix(OUT.suffix + ".ckpt")),
    )

    matched = len(rows_by_id)
    coverage = matched / total
    print(
        f"matched {matched}/{total} = {coverage*100:.1f}% "
        f"({total - matched} requested ids have no GSPC row) in "
        f"{(time.time()-start)/60:.1f}m"
    )

    rl.assert_row_count(
        matched, EXPECTED_ROW_COUNT_MIN, EXPECTED_ROW_COUNT_MAX, SCRIPT_NAME,
        hint="the published XP-spectra population or the request set has "
        "changed; investigate before re-pinning.",
    )
    if coverage < EXPECTED_COVERAGE_MIN:
        raise SystemExit(
            f"{SCRIPT_NAME}: presence coverage {coverage:.1%} below floor "
            f"{EXPECTED_COVERAGE_MIN:.0%} — investigate before re-pinning."
        )

    # Reported rather than routed through report_coverage: the two
    # metrics are nested, not alternative pipelines, so that helper's
    # union line would restate the first of them. The validated-range
    # share is never floored either — it is a property of how bright this
    # catalogue is, not of the pull's health, and a polarity flip
    # upstream is caught by the pinned flag spot-rows.
    for name, pred in (
        ("B and V both present", _both_bands_present),
        ("B and V both in validated range", _both_flags_valid),
    ):
        n = sum(1 for r in rows_by_id.values() if pred(r))
        print(f"  {name.ljust(31)}  {n:>6} ({100 * n / total:.1f}%)")

    assert_flag_domain(list(rows_by_id.values()))
    rl.validate_spot_rows(rows_by_id, SPOT_CHECKS, script_name=SCRIPT_NAME)

    rows = (write_row(rows_by_id[sid]) for sid in source_ids if sid in rows_by_id)
    written = rl.write_tsv(rows, columns=TSV_COLUMNS, output=OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({written} rows)")


if __name__ == "__main__":
    main()
