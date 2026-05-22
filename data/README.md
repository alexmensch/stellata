# Reference data

Frozen external catalogues + per-source data files consumed at build
time. The build does NOT fetch from the network — no `requests.get`,
`urllib`, `astroquery`, or `fetch` calls participate in `npm run build`
or the Python preprocessors. See `scripts/README.md` § Frozen external
data for the policy + § Layer 1 — committed reference data for the
canonical source table.

## Per-source folders

- `athyg/` — AT-HYG v3.3 classic-IDs subset (~64 MB, LFS). The
  ~313k-star catalog the renderer is built around.
- `bailer-jones/` — Bailer-Jones 2021 DR3 Bayesian distance posteriors
  (~23 MB, LFS).
- `gaia/` — Gaia DR3 side-tables: Apsis astrophysical parameters,
  5p astrometry for resolved source_ids, HIP / Tyc cross-walks, NSS
  two-body orbits, Stage 2→3 deduped source_id request list (LFS).
- `hipparcos/` — HIP↔CCDM cross-reference (`hip_ccdm.tsv`) and the
  Hipparcos-2 van Leeuwen 2007 reduction (`hip2_van_leeuwen.tsv`)
  (LFS).
- `gcvs/` — GCVS5 main catalogue + crossid cross-reference (~26 MB
  total, LFS). Variable-star bridging.
- `wds/` — Washington Double Star summary + per-pair notes + reference
  list + ORB6 sixth catalog of visual binary orbits (LFS).
- `simbad/` — Stratified random 10k sample (Tier-C validation source)
  + SIMBAD-curated per-component WDS↔Gaia DR3 cross-IDs (LFS).
- `binaries/` — `multiples.tsv`, the output of
  `scripts/binaries/build-binaries.py` (two rows per kept WDS pair +
  standalone rows for SIMBAD-known components the pair walk didn't
  reach; LFS).
- `distance-validation/` — `vaidman-2025-supergiants.tsv` (132 rows;
  CC BY 4.0) + README with provenance + SIMBAD name-resolution recipe.
  Used by `scripts/distance-validation/`.
- `stellarium/` — Stellarium modern sky-culture (constellation lines,
  ~200 KB, regular git — files are small).
- `local-group/` — Pace 2024 LVDB `dwarf_all` snapshot
  (`lvdb-snapshot.csv`) + hand-curated `overrides.tsv` for LMC, SMC,
  Sgr dSph, M31, M33 etc. (regular git).
- `molecular-clouds/` — Zucker 2020 / 2021 cloud distances + 3D
  bounding boxes + masses + radial profiles (regular git).
- `dust/` — 64 voxel chunks + 50K importance-sampled particle field
  (LFS).

## Adding a new source

1. Fetch once (manually or via a one-shot helper) and commit the raw
   file under the matching `data/<source>/` folder, or create a new
   per-source folder if none fits. Files over ~1 MB ride Git LFS;
   patterns are per-folder in `.gitattributes`, so a new source folder
   needs a new `data/<source>/*.{tsv,csv,txt,…} filter=lfs …` line.
2. Document the source URL + retrieval date in `SCIENCE.md` § Data
   sources.
3. Build scripts read from `data/<source>/<file>`. They do not hit the
   network.
4. If you write a fetch helper, name it explicitly (e.g.
   `scripts/refresh/refresh-clouds.py`) and gate it from
   `npm run build` — refresh is a separate command, not a build step.
