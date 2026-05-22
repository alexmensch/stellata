# Reference data

Frozen external catalogues + per-source data files consumed at build
time. Each source lives in its own subfolder (`athyg/`, `bailer-jones/`,
`gaia/`, `hipparcos/`, `gcvs/`, `wds/`, `simbad/`, `binaries/`,
`distance-validation/`, `stellarium/`, `local-group/`,
`molecular-clouds/`, `dust/`).

## Frozen external data

External scientific catalogs in Stellata's pipeline (stellar, ISM,
nebular, exoplanetary, …) are committed under `data/` and read from
disk at build time. The build does NOT fetch from the network — no
`requests.get`, `urllib`, `astroquery`, or `fetch` calls participate in
`npm run build` or the Python preprocessors.

Why: the build keeps working long-term even when external sources go
offline, change schemas, or move URLs. Existing pattern reflects this
across every input — `data/athyg/athyg_33_classic_ids.csv`,
`data/gcvs/gcvs5.txt`, `data/gcvs/crossid.txt`,
`data/stellarium/stellarium-modern-skyculture.json`, Edenhofer dust via
committed `data/dust/*.bin`, Pace 2024 LVDB
`data/local-group/lvdb-snapshot.csv`, Hipparcos
`data/hipparcos/hip_ccdm.tsv`. Refresh from upstream is an explicit,
manual, infrequent step, not a build dependency.

`data/` is organised by upstream source catalogue:
`wds/`, `gaia/`, `hipparcos/`, `gcvs/`, `athyg/`, `bailer-jones/`,
`simbad/`, `stellarium/`, plus `local-group/`, `molecular-clouds/`,
`dust/` for sources with multi-file layouts. The pipeline-derived
`binaries/multiples.tsv` lives alongside its source folders under
`data/binaries/` so the source-vs-derived split reads cleanly.

When adding new external data:

1. Fetch once (manually or via a one-shot helper) and commit the raw
   file under the matching `data/<source>/` folder, or create a new
   per-source folder if none fits. Files over ~1 MB ride Git LFS (see
   the existing AT-HYG / GCVS / Edenhofer entries; the LVDB snapshot
   is under the threshold and rides regular git). LFS patterns are
   per-folder in `.gitattributes`, so a new source folder needs a new
   `data/<source>/*.{tsv,csv,txt,…} filter=lfs …` line.
2. Document the source URL + retrieval date in `SCIENCE.md` § Data
   sources.
3. Build scripts read from `data/<source>/<file>`. They do not hit the
   network.
4. If you write a fetch helper, name it explicitly (e.g.
   `scripts/refresh/refresh-clouds.py`) and gate it from `npm run
   build` — refresh is a separate command, not a build step.

Applies to JSON / CSV / FITS / HDF5 / TSV catalogs, sky-culture JSON,
dust map binaries — anything sourced from outside the repo.

## Layer 1 — committed reference data

Every external file the build reads, with its upstream source and the
build step that consumes it. Sized files are LFS-backed; small files
ride regular git. Per-source provenance and citations are in
SCIENCE.md § Data sources.

| File | Upstream source | Consumed by |
|---|---|---|
| `athyg/athyg_33_classic_ids.csv` | AT-HYG v3.3 (Astronexus) | `build-catalog.ts` |
| `bailer-jones/bailer-jones-dr3.tsv` | Bailer-Jones 2021 (VizieR I/352) | `build-catalog.ts` (Layer 1 distance override) |
| `gaia/gaia_dr3_apsis.tsv` | Gaia DR3 `astrophysical_parameters` (gspphot ∪ gspspec) | `build-catalog.ts` (Teff/logg/[M/H]/A0 + GSP-Spec sp_type) |
| `gaia/gaia_dr3_hip_xmatch.tsv` | Gaia DR3 `hipparcos2_best_neighbour` | `build-catalog.ts` (HIP→Gaia backfill) + `build-binaries.py` Stage 1 |
| `gaia/gaia_dr3_tyc_xmatch.tsv` | Gaia DR3 `tyco2tdsc_merge_best_neighbour` | `build-binaries.py` Stage 1 |
| `gaia/gaia_dr3_astrometry.tsv` | Gaia DR3 `gaia_source` (subset queried by source_id) | `build-binaries.py` Stage 3 |
| `gaia/gaia_dr3_nss_two_body.tsv` | Gaia DR3 `nss_two_body_orbit` | `build-binaries.py` Stages 3 + 4 |
| `gaia/gaia_astrometry_source_id_request.tsv` | derived from `build-binaries.py` Stage 2 | input to `refresh-gaia-astrometry.py` |
| `gcvs/gcvs5.txt` | GCVS 5.1 (Samus et al. 2017) | `build-catalog.ts` + `build-binaries.py` Stage 1 |
| `gcvs/crossid.txt` | GCVS cross-IDs | `build-catalog.ts` + `build-binaries.py` Stage 1 |
| `hipparcos/hip_ccdm.tsv` | Hipparcos main (VizieR I/239, `HIP/CCDM/MultFlag` slice) | `build-catalog.ts` + `build-binaries.py` Stage 2 (CCDM tier) |
| `hipparcos/hip2_van_leeuwen.tsv` | Hipparcos-2 (van Leeuwen 2007, VizieR I/311) | `build-binaries.py` Stage 3 (long-baseline + Gaia-saturated fallback) |
| `simbad/simbad_sample.tsv` | SIMBAD stratified random 10k sample | `distance-regression-check.ts` + `validate-simbad-sample.ts` |
| `simbad/simbad_sptype.tsv` | SIMBAD per-source `sp_type` | `build-catalog.ts` (Tier 1 spectral) + `build-binaries.py` Stage 6 |
| `simbad/simbad_wds_xids.tsv` | SIMBAD curated `(WDS-J, comp) → (Gaia DR3, HIP)` | `build-binaries.py` Stage 2 (`simbad_xid` tier) |
| `wds/wds_summ.txt` | WDS summary (Mason et al. 2001) | `build-binaries.py` Stage 1 |
| `wds/wds_notes.txt` | WDS notes prose | `build-binaries.py` Stage 5 (flag-char tier) |
| `wds/wds_refs.txt` | WDS reference list | (committed; not parsed today) |
| `wds/orb6_orbits.txt` | ORB6 (Hartkopf, Mason & Worley 2001) | `build-binaries.py` Stages 2 + 4 |
| `binaries/multiples.tsv` | derived from `build-binaries.py` | `known-stars.test.ts` (Tier A) + future per-frame binary-orbit runtime |
| `distance-validation/vaidman-2025-supergiants.tsv` | Vaidman et al. 2025 (CC BY 4.0) | `scripts/distance-validation/validate-distances.py` |
| `stellarium/stellarium-modern-skyculture.json` | Stellarium modern sky culture | `build-catalog.ts` (constellation lines) |
| `local-group/lvdb-snapshot.csv` | Pace 2024 LVDB `dwarf_all` | `build-local-group.ts` |
| `local-group/overrides.tsv` | hand-curated structural detail | `build-local-group.ts` |
| `molecular-clouds/zucker2020-tablea1.tsv` | Zucker 2020 cloud distances (shelved) | `build-clouds.py` |
| `molecular-clouds/zucker2021-table*.dat` | Zucker 2021 cloud geometry (shelved) | `build-clouds.py` |
| `dust/chunk_*.bin`, `particles.bin`, `manifest.json` | Edenhofer 2023 dust map (resampled by `build-dust.py`) | runtime dust loader |

LFS coverage is per-folder via `.gitattributes`; `stellarium/`,
`local-group/`, `molecular-clouds/`, `distance-validation/` stay on
regular git as the files are small.

## Reference epoch and proper motion

Every stellar layer is a J2000.0 snapshot. The solar system is the
only "now" layer in the scene. The two share a frame orientation
(ICRS axes coincide with the J2000.0 equinox) but not a time.

### Per-layer epoch

| Layer | Epoch | How |
|---|---|---|
| Stars (`x0/y0/z0`) | J2000.0 (epoch + equinox) | AT-HYG's upstream README tags `ra`/`dec` as "epoch + equinox 2000.0". AT-HYG is a merge of Tycho-2, Hipparcos, and Gaia DR3 — Gaia DR3 is natively at J2016.0, so AT-HYG back-propagates Gaia rows to J2000.0 using their PM before tabulating. The catalog binary inherits whatever AT-HYG emitted. |
| GCVS variables | n/a (period + amplitude only) | We never consume GCVS positions; the variable rides on its AT-HYG row via the HIP/HD cross-match, so position inherits J2000.0 transitively. |
| Hipparcos CCDM | n/a (flag-only) | We consume `MultFlag` only, never position. |
| Constellation stick figures | n/a (HIP-indexed) | Stellarium's polylines reference HIP IDs; geometry deforms to wherever AT-HYG places the figure stars, so the line endpoints inherit J2000.0 transitively. |
| Local Group dwarfs | J2000.0 | Pace 2024 LVDB's `ra`/`dec` are J2000.0; the hand-curated overrides (LMC, SMC, M31, M33, Sgr dSph) likewise. Extragalactic distances are large enough that arcsecond-scale tangential drift over decades is invisible. |
| Edenhofer 2023 dust | n/a (spatial grid in ICRS) | The voxel grid is ICRS-axis-aligned, so it shares orientation with everything else. Dust drift over decades is sub-pixel at the grid's 1.25 kpc / 512³ resolution. |
| Solar system | Live UTC each frame | JPL Standish 1992 Keplerian elements evaluated at the current Julian Date — no committed positions; the planet renderer evaluates ephemerides per frame. |

### `pm_*` columns are loaded into nothing

The AT-HYG CSV carries `pm_ra`, `pm_dec`, and `pm_src` columns.
`scripts/catalog/build-catalog.ts` and `scripts/catalog/catalog-pure.ts` never read
them — `grep -n 'pm_ra\|pm_dec' scripts/` returns zero hits. The
preprocessor reads only the precomputed Cartesian `x0/y0/z0` triple
and ignores proper-motion data entirely. This is deliberate: no
T-axis animation is currently supported (see SCIENCE.md §
Modelling decisions deliberately not made).

### Staleness consequence

The J2000.0 snapshot is now ~26 years old. For the vast majority of
stars (PM < ~100 mas/yr), the offset between catalog position and
true present-day position is sub-arcsec to a few arcseconds —
invisible at any reasonable FOV. A handful of high-PM neighbours
have visibly drifted, however:

| Star | PM (″/yr) | Offset at J2000 + 26.4 yr |
|---|---|---|
| Barnard's Star | ~10.36 | ~273 ″ ≈ 4.6 arcmin |
| Kapteyn's Star | ~8.67 | ~229 ″ ≈ 3.8 arcmin |
| Groombridge 1830 | ~7.05 | ~186 ″ ≈ 3.1 arcmin |
| Lacaille 9352 | ~6.90 | ~182 ″ ≈ 3.0 arcmin |
| 61 Cygni A | ~5.28 | ~139 ″ ≈ 2.3 arcmin |

At constellation-scale FOV (10–30°) these are tiny but technically
wrong; at close approach or in OBSERVE mode the highest-PM stars
are visibly mis-located.
