# Reference data

Frozen external catalogues + per-source data files consumed at build
time. One subfolder per upstream source. Per-source provenance,
schema, refresh recipe, and consumers live in each folder's README;
this file carries only the cross-folder policies.

## Per-source folders

| Folder | Topic |
|---|---|
| [`athyg/`](athyg/README.md) | AT-HYG v3.3 base stellar catalogue (classic-IDs subset). |
| [`bailer-jones/`](bailer-jones/README.md) | Bailer-Jones 2021 Bayesian distance posteriors. |
| [`gaia/`](gaia/README.md) | Gaia DR3 — cross-walks, astrometry, NSS orbits, Apsis. |
| [`hipparcos/`](hipparcos/README.md) | Hipparcos CCDM cross-reference + HIP2 reduction. |
| [`gcvs/`](gcvs/README.md) | GCVS 5.1 variable-star catalogue + cross-IDs. |
| [`wds/`](wds/README.md) | Washington Double Star + ORB6 visual binary orbits. |
| [`simbad/`](simbad/README.md) | SIMBAD sample, per-source sp_type, WDS↔Gaia cross-IDs. |
| [`binaries/`](binaries/README.md) | Pipeline-derived `multiples.tsv` (output of `build-binaries.py`). |
| [`distance-validation/`](distance-validation/README.md) | Vaidman 2025 BA-supergiant Bayesian distance reference set. |
| [`stellarium/`](stellarium/README.md) | Stellarium modern sky culture (HIP-indexed constellation lines). |
| [`local-group/`](local-group/README.md) | Pace 2024 LVDB dwarf snapshot + hand-curated structural overrides. |
| [`molecular-clouds/`](molecular-clouds/README.md) | Zucker 2020 / 2021 cloud distances + 3D bounding boxes (shelved). |
| [`dust/`](dust/README.md) | Edenhofer 2023 3D dust map (resampled voxel grid + particle field). |
| [`horizons/`](horizons/README.md) | JPL Horizons planet RA/Dec truth set for the sky-truth regression corpus. |
| [`sid/`](sid/README.md) | Stellata ID registry — append-only SID ledger + stored same-as edges (NOT external data; see docs/sid.md). |

## Frozen external data

External scientific catalogues in Stellata's pipeline (stellar, ISM,
nebular, exoplanetary, …) are committed under `data/` and read from
disk at build time. The build does NOT fetch from the network — no
`requests.get`, `urllib`, `astroquery`, or `fetch` calls participate
in `npm run build` or the Python preprocessors.

Why: the build keeps working long-term even when external sources go
offline, change schemas, or move URLs. Refresh from upstream is an
explicit, manual, infrequent step in
[`scripts/refresh/`](../scripts/refresh/README.md), not a build
dependency.

LFS coverage is per-folder via `.gitattributes`; `stellarium/`,
`local-group/`, `molecular-clouds/`, `distance-validation/` stay on
regular git as the files are small.

When adding a new external source:

1. Fetch once (manually or via a one-shot helper) and commit the
   raw file under a new `data/<source>/` folder. Write its
   `README.md` in the same PR — provenance, schema, consumers,
   refresh recipe.
2. Files over ~1 MB ride Git LFS — add the `data/<source>/*.{tsv,csv,…}
   filter=lfs …` line to `.gitattributes`.
3. Document the source URL + retrieval date in SCIENCE.md § Data
   sources and add the row to the per-source README's *Provenance*
   block.
4. Build scripts read from `data/<source>/<file>`. They do not hit
   the network.
5. If you write a fetch helper, name it explicitly (e.g.
   `scripts/refresh/refresh-<source>.py`) and gate it from
   `npm run build` — refresh is a separate command, not a build
   step.

## Reference epoch and proper motion

Every stellar layer is a **J2016.0** snapshot — Gaia DR3's native
reference epoch, adopted catalogue-wide so the Gaia-dominant corpus
needs no propagation and only the shrinking HIP2 / AT-HYG minority
advances (see SCIENCE.md § Driver astrometry). The solar system is the
only "now" layer in the scene. Epoch (position *time*) is distinct from
frame *orientation*: all layers share ICRS axes (the J2000.0 equinox),
which are time-independent — only the epoch at which positions are
measured moved to J2016.0.

### Per-layer epoch

| Layer | Epoch | How |
|---|---|---|
| Stars (catalog.bin xyz) | J2016.0 by construction | Sky directions are resolved per row through the Gaia DR3 5p → HIP2 → AT-HYG cascade and PM-propagated from each source's native epoch to the J2016.0 scene epoch at build time (`scripts/catalog/direction-cascade.ts`, `CATALOG_SCENE_EPOCH`). Gaia routes (~99%) are native J2016.0 — a zero-Δt no-op; HIP2 (J1991.25) advances 24.75 yr. AT-HYG's stored `x0/y0/z0` — a mixed-epoch merge artifact, tens of arcsec off on high-PM stars — is no longer consumed. Only the ~30 tier-3 residual rows keep AT-HYG's printed ra/dec as-is. See SCIENCE.md § Driver astrometry. |
| Binary companions (multiples.tsv → catalog.bin) | J2016.0 by construction | `scripts/binaries/stage6_multiples.py` `_position_pc` PM-propagates every component's position from its native epoch to `CATALOG_SCENE_EPOCH`, mirroring the single-star cascade, so a promoted secondary's baked xyz shares its primary's epoch and the static relative sep/PA is the pair's true J2016.0 geometry. |
| GCVS variables | n/a (period + amplitude only) | We never consume GCVS positions; the variable rides on its AT-HYG row via the HIP/HD cross-match, so position inherits J2016.0 transitively. |
| Hipparcos CCDM | n/a (flag-only) | We consume `MultFlag` only, never position. |
| Constellation stick figures | n/a (HIP-indexed) | Stellarium's polylines reference HIP IDs; geometry deforms to wherever the catalogue places the figure stars, so the line endpoints inherit J2016.0 transitively. |
| Local Group dwarfs | J2000.0 | Pace 2024 LVDB's `ra`/`dec` are J2000.0; the hand-curated overrides (LMC, SMC, M31, M33, Sgr dSph) likewise. Extragalactic distances are large enough that arcsecond-scale tangential drift over decades is invisible, so the 16 yr offset from the stellar scene epoch is immaterial. |
| Edenhofer 2023 dust | n/a (spatial grid in ICRS) | The voxel grid is ICRS-axis-aligned, so it shares orientation with everything else. Dust drift over decades is sub-pixel at the grid's 1.25 kpc / 512³ resolution. |
| Solar system | Live UTC each frame | JPL Standish 1992 Keplerian elements evaluated at the current Julian Date — no committed positions; the planet renderer evaluates ephemerides per frame. |

### Proper motion is a build-time input, not a runtime axis

Gaia DR3 / HIP2 PMs are consumed at build time for the epoch
propagation above, and AT-HYG's `pm_ra`/`pm_dec` for the LMC
kinematic gate — but no PM survives into `catalog.bin`. Single-star
positions are a static J2016.0 snapshot with no T-axis animation
today; runtime propagation to `t` is designed and tracked — see
SCIENCE.md § Current-epoch star positions (velocity routes through
the same cascade: Gaia DR3 / HIP2 PM primary, AT-HYG `pm_*`
last-resort; the advance base is now J2016.0).

### Staleness consequence

The J2016.0 snapshot is ~10 years behind the present day. For the vast
majority of stars (PM < ~100 mas/yr), the offset between catalog
position and true present-day position is sub-arcsec to a couple of
arcseconds — invisible at any reasonable FOV. A handful of high-PM
neighbours have visibly drifted, however (offsets roughly 40% of the
pre-J2016 values):

| Star | PM (″/yr) | Offset at J2016 + 10.5 yr |
|---|---|---|
| Barnard's Star | ~10.36 | ~109 ″ ≈ 1.8 arcmin |
| Kapteyn's Star | ~8.67 | ~91 ″ ≈ 1.5 arcmin |
| Groombridge 1830 | ~7.05 | ~74 ″ ≈ 1.2 arcmin |
| Lacaille 9352 | ~6.90 | ~72 ″ ≈ 1.2 arcmin |
| 61 Cygni A | ~5.28 | ~55 ″ ≈ 0.9 arcmin |

At constellation-scale FOV (10–30°) these are tiny but technically
wrong; at close approach or in OBSERVE mode the highest-PM stars
are visibly mis-located.
