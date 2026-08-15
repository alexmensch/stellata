# Reference data

Frozen external catalogues + per-source data files consumed at build
time. One subfolder per upstream source. Per-source provenance,
schema, refresh recipe, and consumers live in each folder's README;
this file carries only the cross-folder policies.

## Per-source folders

| Folder | Topic |
|---|---|
| [`athyg/`](athyg/README.md) | AT-HYG v3.3 base stellar catalogue (classic-IDs subset) + the frozen inherited spine derived from it. |
| [`classic-ids/`](classic-ids/README.md) | Frozen CDS HD/HR/Bayer/Flamsteed/GJ cross indexes + the source_id-keyed overlay joined from them. |
| [`iau-wgsn/`](iau-wgsn/README.md) | IAU WGSN approved names + glyph-bearing designations (the naming authority) + the derived keyed tables. |
| [`bailer-jones/`](bailer-jones/README.md) | Bailer-Jones 2021 Bayesian distance posteriors. |
| [`gaia/`](gaia/README.md) | Gaia DR3 — cross-walks, astrometry, NSS orbits, Apsis. |
| [`hipparcos/`](hipparcos/README.md) | Hipparcos CCDM cross-reference + HIP2 reduction. |
| [`gcvs/`](gcvs/README.md) | GCVS 5.1 variable-star catalogue + cross-IDs. |
| [`wds/`](wds/README.md) | Washington Double Star + ORB6 visual binary orbits. |
| [`msc/`](msc/README.md) | Pulkovo MSC (Tokovinin) multiple-star hierarchies, orbits, per-component data. |
| [`simbad/`](simbad/README.md) | SIMBAD sample, per-source sp_type, bibcoded values, WDS↔Gaia cross-IDs. |
| [`binaries/`](binaries/README.md) | Pipeline-derived `multiples.tsv` (output of `build-binaries.py`). |
| [`distance-validation/`](distance-validation/README.md) | Vaidman 2025 BA-supergiant Bayesian distance reference set. |
| [`stellarium/`](stellarium/README.md) | Stellarium modern sky culture (HIP-indexed constellation lines). |
| [`local-group/`](local-group/README.md) | Pace 2024 LVDB dwarf snapshot + hand-curated structural overrides. |
| [`molecular-clouds/`](molecular-clouds/README.md) | Zucker 2020 / 2021 cloud distances + 3D bounding boxes. |
| [`local-bubble/`](local-bubble/README.md) | Zucker 2022 Local Bubble inner-surface HEALPix map (dust-wall distance). |
| [`dust/`](dust/README.md) | Edenhofer 2023 3D dust map (resampled voxel grid + particle field). |
| [`bc03/`](bc03/README.md) | Bruzual & Charlot 2003 SSP colour / mass-to-light tables (Chabrier IMF). |
| [`horizons/`](horizons/README.md) | JPL Horizons planet RA/Dec + deep-time vector truth sets for the ephemeris regression corpora. |
| [`ephemerides/`](ephemerides/README.md) | JPL Horizons osculating-element tables for the nine planets across 1900–2100. |
| [`probes/`](probes/README.md) | JPL Horizons heliocentric state vectors for the five Sun-escape deep-space probes. |
| [`textures/`](textures/README.md) | Planet surface/cloud equirect maps + Saturn-ring radial profile (frozen sources + built artifacts). |
| [`sid/`](sid/README.md) | Stellata ID registry — append-only SID ledger + stored same-as edges (NOT external data; see docs/sid.md). |

## Frozen external data

External scientific catalogues in Stellata's pipeline (stellar, ISM,
nebular, exoplanetary, …) are committed under `data/` and read from
disk at build time. The build does NOT fetch from the network — no
`requests.get`, `urllib`, `astroquery`, or `fetch` calls participate
in `pnpm run build` or the Python preprocessors.

Why: the build keeps working long-term even when external sources go
offline, change schemas, or move URLs. Refresh from upstream is an
explicit, manual, infrequent step in
[`scripts/refresh/`](../scripts/refresh/README.md), not a build
dependency.

**"Manual" scopes the build, not the operator.** It means no refresh is
wired into `pnpm run build` — not that a pull is unavailable mid-session.
Agents run these targets directly, so a frozen table missing a column is
a re-pull to execute rather than a design constraint:
[`scripts/refresh/README.md`](../scripts/refresh/README.md) § Who runs a
refresh.

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
3. Document the source URL + retrieval date in `SCIENCE.md` § Data
   sources and add the row to the per-source README's *Provenance*
   block.
4. Build scripts read from `data/<source>/<file>`. They do not hit
   the network.
5. If you write a fetch helper, name it explicitly (e.g.
   `scripts/refresh/refresh-<source>.py`) and gate it from
   `pnpm run build` — refresh is a separate command, not a build
   step.

## Reference epoch and proper motion

Every stellar layer is a **J2016.0** snapshot — Gaia DR3's native
reference epoch, adopted catalogue-wide so the Gaia-dominant corpus
needs no propagation and only the shrinking HIP2 / AT-HYG minority
advances (see `docs/science-catalog-ingestion.md` § Driver astrometry). The solar system is the
only "now" layer in the scene. Epoch (position *time*) is distinct from
frame *orientation*: all layers share ICRS axes (the J2000.0 equinox),
which are time-independent — only the epoch at which positions are
measured moved to J2016.0.

### Per-layer epoch

| Layer | Epoch | How |
|---|---|---|
| Stars (catalog.bin xyz) | J2016.0 by construction | Sky directions are resolved per row through the Gaia DR3 5p → HIP2 → AT-HYG cascade and PM-propagated from each source's native epoch to the J2016.0 scene epoch at build time (`scripts/catalog/distance/direction-cascade.ts`, `CATALOG_SCENE_EPOCH`). Gaia routes (~99%) are native J2016.0 — a zero-Δt no-op; HIP2 (J1991.25) advances 24.75 yr. AT-HYG's stored `x0/y0/z0` — a mixed-epoch merge artifact, tens of arcsec off on high-PM stars — is no longer consumed. Only the tier-3 residual rows (pinned as `directionAthygPrinted` in build-counts, 61 today) keep AT-HYG's printed ra/dec as-is, pending the first-order tiers of `docs/catalog-driver.md` § 5. See `docs/science-catalog-ingestion.md` § Driver astrometry. |
| Binary companions (multiples.tsv → catalog.bin) | J2016.0 by construction | `scripts/binaries/stage6_multiples.py` `_position_pc` PM-propagates every component's position from its native epoch to `CATALOG_SCENE_EPOCH`, mirroring the single-star cascade, so a promoted secondary's baked xyz shares its primary's epoch and the static relative sep/PA is the pair's true J2016.0 geometry. |
| GCVS variables | n/a (period + amplitude only) | We never consume GCVS positions; the variable rides on its AT-HYG row via the HIP/HD cross-match, so position inherits J2016.0 transitively. |
| Hipparcos CCDM | n/a (flag-only) | We consume `MultFlag` only, never position. |
| Constellation stick figures | n/a (HIP-indexed) | Stellarium's polylines reference HIP IDs; geometry deforms to wherever the catalogue places the figure stars, so the line endpoints inherit J2016.0 transitively. |
| Local Group dwarfs | J2000.0 | Pace 2024 LVDB's `ra`/`dec` are J2000.0; the hand-curated overrides (LMC, SMC, M31, M33, Sgr dSph) likewise. Extragalactic distances are large enough that arcsecond-scale tangential drift over decades is invisible, so the 16 yr offset from the stellar scene epoch is immaterial. |
| Edenhofer 2023 dust | n/a (spatial grid in ICRS) | The voxel grid is ICRS-axis-aligned, so it shares orientation with everything else. Dust drift over decades is sub-pixel at the grid's 1.25 kpc / 512³ resolution. |
| Solar system | Live UTC each frame | No committed positions — the renderer evaluates elements per frame at the model clock, converted to TDB. Frozen JPL Horizons element tables ([`ephemerides/`](ephemerides/README.md)) across 1900–2100; the inlined Standish 1992 series outside them. |

### J2016.0 is the wire epoch; the runtime advances to `t`

`catalog.bin` ships positions at the fixed J2016.0 scene epoch AND a
per-star space-motion velocity (`vx/vy/vz`, pc/yr) resolved through the
same trust cascade as direction (Gaia DR3 / HIP2 PM primary, AT-HYG
`pm_*` last-resort, plus AT-HYG `rv`). At load the runtime advances every
position to the model clock — `p(t) = p(J2016) + v·(t − 2016)`,
`src/client/loaders/epoch-advance-pure.ts`, run once before the scene
builds so hover / focus / constellation lines / binaries all inherit
current-epoch positions (`docs/science-catalog-ingestion.md` § Current-epoch star positions). The
wire stays J2016.0 (stable regression corpus, no rebuild to stay
current); the epoch a viewer sees is `getT()`.

### The staleness the advance corrects

The J2016.0 wire baseline is ~10 years behind now; the load-time advance
closes that gap. For most stars (PM < ~100 mas/yr) the correction is
sub-arcsec — invisible — but the high-PM neighbours below were visibly
mis-located before the advance and now track the current epoch (offsets
are the drift the advance removes, roughly 40% of the pre-J2016 values):

| Star | PM (″/yr) | Drift corrected at J2016 + 10.5 yr |
|---|---|---|
| Barnard's Star | ~10.36 | ~109 ″ ≈ 1.8 arcmin |
| Kapteyn's Star | ~8.67 | ~91 ″ ≈ 1.5 arcmin |
| Groombridge 1830 | ~7.05 | ~74 ″ ≈ 1.2 arcmin |
| Lacaille 9352 | ~6.90 | ~72 ″ ≈ 1.2 arcmin |
| 61 Cygni A | ~5.28 | ~55 ″ ≈ 0.9 arcmin |

Within-session drift after the load-time advance is invisible
(~0.001″/h); scrubber-time re-advance for deep-time scrubbing is
`stellata-nmu.5`.
