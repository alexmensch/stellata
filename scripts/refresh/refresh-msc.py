#!/usr/bin/env python3
"""Refresh data/msc/ — Tokovinin's Multiple Star Catalog (VizieR
J/ApJS/235/6, author-updated): systems hierarchy, orbit elements, and
per-component data. Three TSVs, one per MSC table."""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "util"))

import refresh_lib as rl  # noqa: E402
from paths import REPO_ROOT  # noqa: E402

ROOT = REPO_ROOT
OUT_DIR = ROOT / "data" / "msc"
OUT_SYSTEMS = OUT_DIR / "msc_systems.tsv"
OUT_ORBITS = OUT_DIR / "msc_orbits.tsv"
OUT_COMPONENTS = OUT_DIR / "msc_components.tsv"


class TableSpec:
    def __init__(
        self,
        vizier_table: str,
        output: Path,
        column_map: dict[str, str],
        expected_schema: dict[str, type | tuple[type, ...]],
        row_bounds: tuple[int, int],
    ) -> None:
        self.vizier_table = vizier_table
        self.output = output
        self.column_map = column_map
        self.expected_schema = expected_schema
        self.row_bounds = row_bounds

    @property
    def adql(self) -> str:
        cols = ", ".join(f'"{c}"' for c in self.column_map)
        return f'SELECT {cols} FROM "{self.vizier_table}"'


# MSC "Syst" / "Prim" / "Sec" / "Parent" labels are Tokovinin's own
# hierarchy labels, NOT WDS component letters (MSC re-labels below the
# top level: ν Sco's WDS Aa,Ab pair is MSC's Aab,Ac). The build-side
# mapping to WDS tokens is scripts/binaries/msc_map.py; these TSVs keep
# the raw labels.
TABLES: tuple[TableSpec, ...] = (
    TableSpec(
        vizier_table="J/ApJS/235/6/systems",
        output=OUT_SYSTEMS,
        column_map={
            "ID": "wds_id",
            "Prim": "prim",
            "Sec": "sec",
            "Parent": "parent",
            "Type": "obs_type",
            "Per": "per",
            "x_Per": "per_unit",
            "Sep": "sep",
            "x_Sep": "sep_unit",
            "PA": "pa_deg",
            "Vmag1": "vmag1",
            "SpT1": "spt1",
            "Vmag2": "vmag2",
            "SpT2": "spt2",
            "Mass1": "mass1_msun",
            "Mass2": "mass2_msun",
        },
        expected_schema={
            "ID": str, "Prim": str, "Sec": str, "Parent": str,
            "Type": str, "Per": float, "x_Per": str,
            "Sep": float, "x_Sep": str, "PA": float,
            "Vmag1": float, "SpT1": str, "Vmag2": float, "SpT2": str,
            "Mass1": float, "Mass2": float,
        },
        row_bounds=(13_000, 17_000),
    ),
    TableSpec(
        vizier_table="J/ApJS/235/6/orbits",
        output=OUT_ORBITS,
        column_map={
            "ID": "wds_id",
            "Syst": "syst",
            "Per": "per",
            "x_Per": "per_unit",
            "T": "t0",
            "e": "e",
            "a": "a_arcsec",
            "Node": "node_deg",
            "LongP": "longp_deg",
            "Incl": "incl_deg",
            "K1": "k1_kms",
            "K2": "k2_kms",
            "V0": "v0_kms",
            "Flag": "node_flag",
            "Note": "note",
        },
        expected_schema={
            "ID": str, "Syst": str, "Per": float, "x_Per": str,
            "T": float, "e": float, "a": float,
            "Node": float, "LongP": float, "Incl": float,
            "K1": float, "K2": float, "V0": float,
            "Flag": str, "Note": str,
        },
        row_bounds=(4_000, 6_500),
    ),
    TableSpec(
        vizier_table="J/ApJS/235/6/catalog",
        output=OUT_COMPONENTS,
        column_map={
            "ID": "wds_id",
            "m_ID": "comp",
            "SpT": "spt",
            "Vmag": "vmag",
            "Bmag": "bmag",
            "Sep": "sep_arcsec",
            "HIP": "hip",
            "HD": "hd",
            "plx": "plx_mas",
        },
        expected_schema={
            "ID": str, "m_ID": str, "SpT": str,
            "Vmag": float, "Bmag": float, "Sep": float,
            "HIP": int, "HD": int, "plx": float,
        },
        row_bounds=(11_000, 15_000),
    ),
)

# AR Cas Aa,Ab — the showcase eclipsing SB the ingest exists to render.
SPOT_ORBIT_WDS_ID = "23300+5833"
SPOT_ORBIT_SYST = "Aa,Ab"
SPOT_ORBIT_PER_DAYS = 6.0663
SPOT_ORBIT_TOL = 0.01


def main() -> None:
    force = "--force" in sys.argv

    outputs = [t.output for t in TABLES]
    if not force and all(
        rl.is_up_to_date(out, [Path(__file__)]) for out in outputs
    ):
        print(
            f"{OUT_DIR.relative_to(ROOT)}/*.tsv up to date — skipping "
            "(use --force to rebuild)"
        )
        return

    client = rl.TapClient(backends=[rl.cds_backend()])
    for spec in TABLES:
        print(f'querying CDS TAP — "{spec.vizier_table}" …')
        t0 = time.time()
        table = client.run(spec.adql)
        print(f"  {len(table)} rows in {time.time() - t0:.1f}s")

        rl.validate_schema(table, spec.expected_schema, label=spec.vizier_table)
        lo, hi = spec.row_bounds
        rl.assert_row_count(
            len(table), lo, hi, f"refresh-msc: {spec.vizier_table}",
            hint="upstream drift; investigate before re-pinning.",
        )

        if spec.output is OUT_ORBITS:
            spot = [
                r for r in table
                if str(r["ID"]) == SPOT_ORBIT_WDS_ID
                and str(r["Syst"]) == SPOT_ORBIT_SYST
            ]
            if not spot:
                raise SystemExit(
                    f"refresh-msc: spot-check orbit {SPOT_ORBIT_WDS_ID} "
                    f"{SPOT_ORBIT_SYST} (AR Cas) missing from result."
                )
            per = rl.coerce_masked(spot[0]["Per"])
            unit = str(rl.coerce_masked(spot[0]["x_Per"]) or "")
            if (
                per is None or unit != "d"
                or abs(float(per) - SPOT_ORBIT_PER_DAYS) > SPOT_ORBIT_TOL
            ):
                raise SystemExit(
                    f"refresh-msc: spot-check AR Cas Aa,Ab period drift — "
                    f"got {per} {unit}, expected ~{SPOT_ORBIT_PER_DAYS} d."
                )

        rows = (
            {
                canonical: rl.coerce_masked(row[vizier])
                for vizier, canonical in spec.column_map.items()
            }
            for row in table
        )
        written = rl.write_tsv(
            rows, columns=list(spec.column_map.values()), output=spec.output,
        )
        print(f"wrote {spec.output.relative_to(ROOT)} ({written} rows)")


if __name__ == "__main__":
    main()
