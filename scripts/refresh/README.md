# External-catalogue refresh

**Layer 2** of the build/data split — manual, infrequent refresh of
the frozen external catalogues under `data/`. Never wired into
`pnpm run build`. The freshness policy is in `data/README.md`
§ Frozen external data; the per-source table is in `data/README.md`
§ Layer 1 — committed reference data.

## Who runs a refresh

**"Manual" means not wired into `pnpm run build` — it does not mean a
human has to be the one to type it.** Claude Code sessions have network
access and run every target on this page directly, including the long
batched pulls.

So a column a frozen table lacks is a **re-pull to execute**, not a
constraint to design around. Adding `radial_velocity` to the 5p schema,
re-slicing a VizieR table for one more column, re-stratifying the SIMBAD
sample — all are in-session work. Never scope a design down, defer a
field, or hand a pull back to the user on the assumption that a network
fetch is out of reach; the cost is the pull's wall-clock time, and
`--force` / the `.ckpt` resume path (§ Resuming a long pull) bound the
retry risk.

What still needs a human: deciding to **freeze** a newly-pulled table
(`data/README.md` § Frozen external data governs when a refresh is
warranted at all), and reviewing the count/coverage diff a re-pull
produces.

## Layer 2 — refresh scripts

Every refresh script is **manually invoked**, never wired into
`pnpm run build`. The freshness policy (above) drives the split: build
reads committed files, refresh writes them. Each script lives under
`scripts/refresh/`, takes no required arguments (the deduped source_id
request file is the one exception — `refresh-gaia-astrometry.py` reads
the file Stage 2 writes), and atomically replaces its output TSV under
`data/`.

### One-time setup

The refresh scripts use astropy + numpy + pyvo + requests. Pin them to a
local virtualenv so the system Python stays clean:

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/refresh/requirements-refresh.txt
```

After that, prefix every `python3` invocation with `.venv/bin/`, or
shell-activate via `source .venv/bin/activate`. The pnpm targets below
call bare `python3` — activate the venv (or alias `python3` to the
venv binary) in the shell that runs them.

### Per-script targets

| pnpm target | Script | Output | What it pulls |
|---|---|---|---|
| `refresh:gaia-hip` | `refresh-gaia-hip-xmatch.py` | `data/gaia/gaia_dr3_hip_xmatch.tsv` | HIP → Gaia DR3 source_id cross-walk from `hipparcos2_best_neighbour`. |
| `refresh:gaia-tyc` | `refresh-gaia-tyc-xmatch.py` | `data/gaia/gaia_dr3_tyc_xmatch.tsv` | Tycho-2 → Gaia DR3 cross-walk from `tyco2tdsc_merge_best_neighbour`. |
| `refresh:gaia-nss` | `refresh-gaia-nss.py` | `data/gaia/gaia_dr3_nss_two_body.tsv` | Gaia DR3 `nss_two_body_orbit` (binary orbits Gaia detected astrometrically). |
| `refresh:gaia-astrometry` | `refresh-gaia-astrometry.py` | `data/gaia/gaia_dr3_astrometry.tsv` | Gaia DR3 5-parameter astrometry for exactly the source_ids `build-binaries.py` Stage 2 resolved (reads `data/gaia/gaia_astrometry_source_id_request.tsv` as input). Run AFTER `refresh:gaia-hip` + `refresh:gaia-tyc` + a fresh `pnpm run build:binaries`. |
| `build:astrometry-request` | `scripts/catalog/astrometry-request/export-astrometry-request.ts` | `data/gaia/gaia_catalog_source_id_request.tsv` | Full-catalog deduped Gaia DR3 source_id request list — the spine's `gaia_source_id` column (the same binding the record build reads) UNION the classic-ID binding gate's candidate sources. Not a network pull. Reads the spine plus both Gaia cross-walks, so it still runs AFTER `refresh:gaia-hip` / `refresh:gaia-tyc`. |
| `refresh:gaia-astrometry-catalog` | `refresh-gaia-astrometry-catalog.py` | `data/gaia/gaia_dr3_astrometry_catalog.tsv` | Gaia DR3 5p astrometry + `radial_velocity` for every catalog source_id (~312k) — tier 1 of the direction, rv, V and ci cascades. Same schema/query as `refresh:gaia-astrometry`; reads `gaia_catalog_source_id_request.tsv`. Run AFTER `build:astrometry-request`. |
| `refresh:gaia-apsis` | `refresh-gaia-apsis.py` | `data/gaia/gaia_dr3_apsis.tsv` | Gaia DR3 `astrophysical_parameters` (gspphot ∪ gspspec) — Teff / log g / [M/H] / A0 + GSP-Spec `spectraltype_esphs` enum. |
| `refresh:gaia-gspc` | `refresh-gaia-gspc.py` | `data/gaia/gaia_dr3_gspc.tsv` | Gaia DR3 `synthetic_photometry_gspc` — Johnson-Kron-Cousins B/V synthesised per source from its BP/RP spectrum, with fluxes and the per-band validated-range flag. Reads `gaia_catalog_source_id_request.tsv`, so it runs AFTER `build:astrometry-request`. Flag polarity and the S/N > 30 cut this table already applies — `data/gaia/README.md` § The GSPC validated-range flag. |
| `refresh:gaia-dr2-neighbourhood` | `refresh-gaia-dr2-neighbourhood.py` | `data/gaia/gaia_dr2_neighbourhood.tsv` | DR2 ↔ DR3 cross-match candidates (`gaiadr3.dr2_neighbourhood`) for the Gaia-only catalog stars (reads `data/gaia/gaia_dr2_neighbourhood_request.tsv`). Input to the SID DR-reconciliation dry run — `docs/sid.md` § DR2→DR3 dry run, incl. the request-file derivation recipe. |
| `refresh:bailer-jones` | `refresh-bailer-jones.py` | `data/bailer-jones/bailer-jones-dr3.tsv` | Bailer-Jones 2021 photogeometric + geometric distance posteriors per Gaia DR3 source_id. |
| `refresh:hip2` | `refresh-hipparcos2.py` | `data/hipparcos/hip2_van_leeuwen.tsv` | Hipparcos-2 (van Leeuwen 2007) reduction. |
| `refresh:hip-vmag` | `refresh-hipparcos-vmag.py` | `data/hipparcos/hip_main_vmag.tsv` | Printed Johnson V and B−V per HIP from `I/239/hip_main` — the printed tiers of the V-magnitude and ci cascades. |
| `refresh:classic-ids` | `refresh-classic-ids.py` | `data/classic-ids/{tyc2_hd,cross_index,bsc5,cns5}.tsv` | The four frozen CDS classic-designation cross indexes (`IV/25`, `IV/27A`, `V/50`, CNS5 `J/A+A/670/A19`). Four slices in one script; `--only <stem>` limits it to one. |
| `refresh:iau-wgsn` | `refresh-iau-wgsn.py` | `data/iau-wgsn/{NEC,wgsnFaints}.csv` | The IAU WGSN naked-eye catalogue + faint approved names (plain HTTP, not TAP; schema / row-band / spot-row gates). Follow with `pnpm run build:wgsn`. |
| `refresh:simbad` | `refresh-simbad-sample.py` | `data/simbad/simbad_sample.tsv` | Stratified random 10k SIMBAD sample (validation corpus). |
| `validate:simbad` | `scripts/catalog/validate/validate-simbad-sample.ts` | (report only) | Tier C — cross-check `public/catalog.bin` against the committed SIMBAD sample. The build-time subset of the same check is `distance-regression-check.ts`, gated on `build-distance-outliers-expected.json`. |

`refresh-simbad-sptype.py`, `refresh-simbad-wds-xids.py`, and
`refresh-msc.py` don't yet have dedicated pnpm targets — invoke
directly with `python3 scripts/refresh/<script>.py`. The two SIMBAD
scripts share `scripts/refresh/simbad/` plumbing (`specs.py`,
`inputs.py`, `query.py`, `tsv.py`) so adding new SIMBAD-anchored pulls
reuses the entire stack. `refresh-msc.py` pulls the three Pulkovo MSC
tables (VizieR `J/ApJS/235/6`) into `data/msc/` with per-table schema
validation and row bounds — source detail in `data/msc/README.md`.

`read_source_id_request` lives in `refresh_lib` rather than beside any
one pull, because three scopes now read the same one-column TSV contract:
the binaries astrometry list, the full-catalog list, and the DR2
neighbourhood risk set.

Non-network dependency: `refresh-gaia-gspc.test.py` covers that pull's
write widths, the per-band-null shape a both-bands-or-nothing writer
would corrupt, and `assert_flag_domain` — the only automated guard on the
`0`/`1` flag domain whose polarity the ci cascade reads. Run it with
`python3 scripts/refresh/refresh-gaia-gspc.test.py`.

`scripts/refresh/refresh_lib.py` is the shared TAP / Astroquery /
atomic-rename plumbing every refresh script imports — handles retry,
batched pulls (`run_in_batches`), schema validation, row-count and
coverage gating (`assert_row_count`, `report_coverage`), spot-check
pinning (`validate_spot_rows`, `check_spot_rows_tolerant`), and
partial-write protection so a mid-run failure never leaves a
half-written TSV under `data/`. `assert_row_count` is also imported by
`scripts/binaries/build-binaries.py` for its Stage-1 parser bounds.

### VizieR column slices

`vizier_slice.py` runs the declarative case: whole VizieR table, column
subset, committed TSV. A `VizierSlice` carries the table id, the
VizieR→canonical column map (which also fixes the TSV column order), the
dtype schema, a row-count band, and pinned spot rows; `pull_slices()`
executes a list of them, folding its own mtime into each slice's
idempotency check the way `is_up_to_date` folds in `refresh_lib`'s.
`refresh-classic-ids.py` (four slices) and `refresh-hipparcos-vmag.py`
(one) are then spec files with no query logic of their own — the same
split `gaia_astrometry_pull.py` uses for the 5p pulls.

**MAXREC is not load-bearing on CDS.** VizieR's TAP default MAXREC is
~1e9, so a whole-table slice needs none of the sizing the Gaia sync
endpoints demand (next section); the row-count band is what catches an
upstream row loss here. Coverage of the pull is asserted downstream
instead — `pnpm run build:classic-ids` pins per-identifier counts.

Non-network dependency: `vizier_slice.test.py` covers the ADQL shape, the
row-count / spot-row gates, the `--only` selector, and the
no-partial-write guarantee against an in-memory TAP backend. Run it with
`python3 scripts/refresh/vizier_slice.test.py`.

### Gaia TAP: synchronous endpoints only

Every `gaiadr3.*` pull goes through `refresh_lib.gaia_sync_client()` —
ESA `/sync` primary, ARI Heidelberg `/sync` fallback, both hosting the
identical `gaiadr3.*` schema. The ESA archive's ASYNC path intermittently
500s on result retrieval while its sync endpoint stays healthy, so
nothing reaches Gaia any other way: the async client is gone, and with
it the `astroquery` dependency.

`TapClient` takes `backends=` as a required argument — there is no
default list, because which service can serve a query is a property of
the table. CDS VizieR doesn't host `gaiadr3.*`, so an ESA→CDS fallback
would fail with a misleading "table not found";
`refresh-bailer-jones.py` and `refresh-hipparcos2.py` go the other way
and pass `backends=[cds_backend()]` because their tables are
VizieR-only. SIMBAD gets `[simbad_backend()]` for its divergent dialect.

**MAXREC is load-bearing.** A sync endpoint answers HTTP 200 and flags
truncation in a VOTable `QUERY_STATUS` INFO rather than erroring, so a
MAXREC below the result size would silently short a pull. Two sizing
rules, and neither may be replaced with a bare literal:

- Whole-table pulls (hip-xmatch, tyc-xmatch, nss) call
  `whole_table_sync_maxrec(EXPECTED_ROW_COUNT_MAX)` — double the pinned
  ceiling, clamped to the mirrors' 3 M-row output cap. It exits rather
  than clamp below the ceiling, so a table that outgrows one sync query
  demands batching instead of failing quietly. tyc-xmatch is the pull
  that clamps: 2.52 M rows leaves ~19% headroom, not 2x.
- Batched pulls size MAXREC off their batch size (`BATCH_SIZE * 2`),
  except `refresh-gaia-dr2-neighbourhood.py`, where one requested id can
  return several rows.

`SyncOverflowError` covers the truncation case and is deliberately NOT
classified transient — retrying or switching mirrors at the same MAXREC
truncates identically, so it fails fast naming the MAXREC to raise.

### Resuming a long pull

`run_in_batches(..., checkpoint=rl.BatchCheckpoint(out.with_suffix(
out.suffix + '.ckpt')))` makes a batched pull resumable: each batch is
cached under `<output>.tsv.ckpt/` as it lands, and a re-run replays the
cached batches and queries only what's missing. Apsis and Bailer-Jones
run ~63 batches each, so a drop on batch 60 used to cost the whole pull.
The directory is removed only once every batch has landed — **a
surviving `.tsv.ckpt/` directory means the previous run did not finish**.
It's gitignored, and discarded automatically when the request set or
batch size changes (the cache is fingerprinted on both, since batch N of
a different request set covers different source_ids). Deleting it by
hand is always safe — it only forces a full re-pull.

`scripts/refresh/gaia_astrometry_pull.py` is the shared 5p-astrometry
pull (schema, ADQL, batching, coverage + spot-check gates, atomic
write); `refresh-gaia-astrometry.py` (binaries scope) and
`refresh-gaia-astrometry-catalog.py` (full-catalog scope) are thin
wrappers that only define their request/output paths and pinned
spot-check rows.

`TSV_COLUMNS` there is the one place the schema is stated, so **a column
added to it lands in both scopes** — but only in whichever output is
actually re-pulled. `radial_velocity` was added for the catalog scope's
rv cascade; the binaries-scope `gaia_dr3_astrometry.tsv` gains the column
on its next refresh and nothing reads rv from it meanwhile. Editing the
module also invalidates both outputs' `is_up_to_date` check (it folds this
file's mtime), which is what makes the next binaries refresh pick it up
rather than skip.

**`radial_velocity_error` landed in the catalog scope on the 2026-08-12
refresh**, and `parseGaiaAstrometryCatalogTsv` now requires it. Its consumer
is the build-counts ratchet, not a filter — the cascade takes DR3's value
whatever error it states (`../catalog/distance/README.md` § Radial velocity).
The binaries-scope `gaia_dr3_astrometry.tsv` still predates the column, on the
same terms as `radial_velocity` above.

See `RELEASING.md` § Catalogue refresh policy for the cadence
(event-driven, not scheduled) and the version-bump policy for a
catalogue-refresh PR.

## Refreshing data when DR4 / new AT-HYG lands

The full Gaia data-release transition takes coordinated refreshes
because the source_id space changes; partial refreshes leave the
catalogue inconsistent. Order matters:

1. **Swap AT-HYG.** Drop the new `athyg_3X_classic_ids.csv` into
   `data/athyg/`. Re-run `pnpm run build:catalog` to confirm parse + drift
   against the expected snapshot. (The build will fail loudly because
   the side-files are still keyed to DR3.)
2. **Refresh the Gaia DR4-keyed side-files** in any order — they're
   independent pulls keyed on the deduped source_id list:
   `refresh-gaia-hip-xmatch.py`, `refresh-gaia-tyc-xmatch.py`,
   `refresh-gaia-astrometry.py`, `refresh-gaia-nss.py`,
   `refresh-gaia-apsis.py`, `refresh-bailer-jones.py`.
   Each commits its TSV under `data/gaia/` or `data/bailer-jones/`.
   Then regenerate the full-catalog astrometry (two stages, in this
   order): `pnpm run build:astrometry-request` (the spine's
   `gaia_source_id` column plus the classic-ID gate's candidates, so it
   runs after both cross-walk refreshes), then
   `pnpm run refresh:gaia-astrometry-catalog`. Under a DR transition the
   spine's `gaia_dr3:` ids bridge through `docs/sid.md` § 6 first —
   requesting DR3 ids against a DR4 table returns nothing.
3. **Refresh HIP2 + SIMBAD if upstream republished** — these are
   keyed on HIP / SIMBAD `oid` respectively, so they don't change
   under a Gaia DR transition unless their own pipeline updated.
4. **Re-run `pnpm run build:binaries`** then **`pnpm run build:catalog`**.
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
