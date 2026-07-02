# External-catalogue refresh

**Layer 2** of the build/data split — manual, infrequent refresh of
the frozen external catalogues under `data/`. Never wired into
`npm run build`. The freshness policy is in `data/README.md`
§ Frozen external data; the per-source table is in `data/README.md`
§ Layer 1 — committed reference data.

## Layer 2 — refresh scripts

Every refresh script is **manually invoked**, never wired into
`npm run build`. The freshness policy (above) drives the split: build
reads committed files, refresh writes them. Each script lives under
`scripts/refresh/`, takes no required arguments (the deduped source_id
request file is the one exception — `refresh-gaia-astrometry.py` reads
the file Stage 2 writes), and atomically replaces its output TSV under
`data/`.

### One-time setup

The refresh scripts use astroquery + astropy + numpy. Pin them to a
local virtualenv so the system Python stays clean:

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/refresh/requirements-refresh.txt
```

After that, prefix every `python3` invocation with `.venv/bin/`, or
shell-activate via `source .venv/bin/activate`. The npm targets below
call bare `python3` — activate the venv (or alias `python3` to the
venv binary) in the shell that runs them.

### Per-script targets

| npm target | Script | Output | What it pulls |
|---|---|---|---|
| `refresh:gaia-hip` | `refresh-gaia-hip-xmatch.py` | `data/gaia/gaia_dr3_hip_xmatch.tsv` | HIP → Gaia DR3 source_id cross-walk from `hipparcos2_best_neighbour`. |
| `refresh:gaia-tyc` | `refresh-gaia-tyc-xmatch.py` | `data/gaia/gaia_dr3_tyc_xmatch.tsv` | Tycho-2 → Gaia DR3 cross-walk from `tyco2tdsc_merge_best_neighbour`. |
| `refresh:gaia-nss` | `refresh-gaia-nss.py` | `data/gaia/gaia_dr3_nss_two_body.tsv` | Gaia DR3 `nss_two_body_orbit` (binary orbits Gaia detected astrometrically). |
| `refresh:gaia-astrometry` | `refresh-gaia-astrometry.py` | `data/gaia/gaia_dr3_astrometry.tsv` | Gaia DR3 5-parameter astrometry for exactly the source_ids `build-binaries.py` Stage 2 resolved (reads `data/gaia/gaia_astrometry_source_id_request.tsv` as input). Run AFTER `refresh:gaia-hip` + `refresh:gaia-tyc` + a fresh `npm run build:binaries`. |
| `build:astrometry-request` | `scripts/catalog/export-astrometry-request.ts` | `data/gaia/gaia_catalog_source_id_request.tsv` | Full-catalog deduped Gaia DR3 source_id request list — every AT-HYG row resolved via `resolveGaiaSourceId` (native `gaia` → HIP cross-walk). Not a network pull; reads `data/athyg/` + `data/gaia/gaia_dr3_hip_xmatch.tsv`. Run AFTER a fresh `refresh:gaia-hip`. |
| `refresh:gaia-astrometry-catalog` | `refresh-gaia-astrometry-catalog.py` | `data/gaia/gaia_dr3_astrometry_catalog.tsv` | Gaia DR3 5-parameter astrometry for every catalog-resolvable source_id (~315k) — the direction-cascade input. Same schema/query as `refresh:gaia-astrometry`; reads `gaia_catalog_source_id_request.tsv`. Run AFTER `build:astrometry-request`. |
| `refresh:gaia-apsis` | `refresh-gaia-apsis.py` | `data/gaia/gaia_dr3_apsis.tsv` | Gaia DR3 `astrophysical_parameters` (gspphot ∪ gspspec) — Teff / log g / [M/H] / A0 + GSP-Spec `spectraltype_esphs` enum. |
| `refresh:bailer-jones` | `refresh-bailer-jones.py` | `data/bailer-jones/bailer-jones-dr3.tsv` | Bailer-Jones 2021 photogeometric + geometric distance posteriors per Gaia DR3 source_id. |
| `refresh:hip2` | `refresh-hipparcos2.py` | `data/hipparcos/hip2_van_leeuwen.tsv` | Hipparcos-2 (van Leeuwen 2007) reduction. |
| `refresh:simbad` | `refresh-simbad-sample.py` | `data/simbad/simbad_sample.tsv` | Stratified random 10k SIMBAD sample (validation corpus). |
| `validate:simbad` | `scripts/catalog/validate-simbad-sample.ts` | (report only) | Tier C — cross-check `public/catalog.bin` against the committed SIMBAD sample. The build-time subset of the same check is `distance-regression-check.ts`, gated on `build-distance-outliers-expected.json`. |

`refresh-simbad-sptype.py` and `refresh-simbad-wds-xids.py` don't yet
have dedicated npm targets — invoke directly with `python3
scripts/refresh/refresh-simbad-sptype.py` /
`refresh-simbad-wds-xids.py`. Both share `scripts/refresh/simbad/`
plumbing (`specs.py`, `inputs.py`, `query.py`, `tsv.py`) so adding new
SIMBAD-anchored pulls reuses the entire stack.

`scripts/refresh/refresh_lib.py` is the shared TAP / Astroquery /
atomic-rename plumbing every refresh script imports — handles retry,
batching, schema validation, and partial-write protection so a
mid-run failure never leaves a half-written TSV under `data/`.

`scripts/refresh/gaia_astrometry_pull.py` is the shared 5p-astrometry
pull (schema, ADQL, batching, coverage + spot-check gates, atomic
write); `refresh-gaia-astrometry.py` (binaries scope) and
`refresh-gaia-astrometry-catalog.py` (full-catalog scope) are thin
wrappers that only define their request/output paths and pinned
spot-check rows.

See `RELEASING.md` § Catalogue refresh policy for the cadence
(event-driven, not scheduled) and the version-bump policy for a
catalogue-refresh PR.

## Refreshing data when DR4 / new AT-HYG lands

The full Gaia data-release transition takes coordinated refreshes
because the source_id space changes; partial refreshes leave the
catalogue inconsistent. Order matters:

1. **Swap AT-HYG.** Drop the new `athyg_3X_classic_ids.csv` into
   `data/athyg/`. Re-run `npm run build:catalog` to confirm parse + drift
   against the expected snapshot. (The build will fail loudly because
   the side-files are still keyed to DR3.)
2. **Refresh the Gaia DR4-keyed side-files** in any order — they're
   independent pulls keyed on the deduped source_id list:
   `refresh-gaia-hip-xmatch.py`, `refresh-gaia-tyc-xmatch.py`,
   `refresh-gaia-astrometry.py`, `refresh-gaia-nss.py`,
   `refresh-gaia-apsis.py`, `refresh-bailer-jones.py`.
   Each commits its TSV under `data/gaia/` or `data/bailer-jones/`.
   Then regenerate the full-catalog astrometry (two stages, after
   `refresh-gaia-hip-xmatch.py`): `npm run build:astrometry-request`
   (resolves the source_id list from the new AT-HYG + HIP cross-walk),
   then `npm run refresh:gaia-astrometry-catalog`.
3. **Refresh HIP2 + SIMBAD if upstream republished** — these are
   keyed on HIP / SIMBAD `oid` respectively, so they don't change
   under a Gaia DR transition unless their own pipeline updated.
4. **Re-run `npm run build:binaries`** then **`npm run build:catalog`**.
   Both build steps reassert against their snapshots; the count diffs
   are the first place to look for regressions.
5. **`UPDATE_BUILD_COUNTS=1` then `UPDATE_DISTANCE_OUTLIERS=1`** to
   refresh both snapshots once the new build is reviewed. Re-edit the
   `reason` strings on the distance-outliers snapshot for any new
   outliers.
6. **Re-run Tier A and Tier C.** Tier A's known-stars table may need
   per-row source_id updates if Gaia DR4's source_ids changed for the
   tracked stars (Gaia publishes a DR3↔DR4 cross-walk during the
   transition window). Tier C's `simbad_sample.tsv` should be
   refreshed via `refresh-simbad-sample.py` to re-stratify against the
   new AT-HYG.
