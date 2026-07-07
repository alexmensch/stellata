# Extragalactic deep-field roadmap

Design gate for the stellata-0hx epic: extend the model from the Local
Group (~2 Mpc, `src/client/local-group/`) out to the observable
horizon. This doc fixes the decisions the tier-implementation beads
(stellata-0hx.2–.8) execute against: data inventory, cosmology,
manifest schema, naming policy, morphology palette, selection-bias
handling, and the three cross-cutting architecture changes. The epic
body carries the motivating survey + per-tier performance analysis;
this doc carries the *decisions*.

All source URLs verified live 2026-07-06 (retrieval flags in § Access
flags). Frozen-data policy applies throughout: every catalogue is
fetched once by a one-off `scripts/refresh-*` script excluded from
`npm run build`, committed under `data/extragalactic/` (LFS above
~1 MB), and the build never touches the network.

## Tier map

| Tier | Reach | Primary sources | Primitive | Format |
| --- | --- | --- | --- | --- |
| 1 Local Volume | ~12 Mpc | UNGC + LVDB (+ SGA-2020 structure) | ~50 wireframes + billboards | JSON |
| 2 LSC + Virgo | ~30 Mpc | EVCC + 2MRS | billboards + cluster shells | JSON |
| 3 Laniakea | ~150 Mpc | Cosmicflows-4 + Dupuy watersheds | billboards + 6 basin shells | binary |
| 4 Cosmic web | ~1 Gpc | NED-LVS + SDSS Main | point glows, chunked | binary, chunked |
| 5 BOSS/eBOSS | ~3 Gpc | eBOSS DR16 LSS catalogues | z-coloured point glows | binary, chunked |
| 6 CMB | ~14 Gpc | Planck 2018 SMICA | skybox sphere | cubemap/texture |

## 1. Data inventory

Per source: download route, size, licence, citation. Retrieval steps
belong in each tier's `scripts/refresh-*` script header; this table is
the authoritative pointer set.

### Tier 1 — Local Volume

- **UNGC** — Karachentsev, Makarov & Kaisina 2013, AJ 145, 101
  (arXiv:1303.5328). Fixed-width tables from CDS:
  `https://cdsarc.cds.unistra.fr/ftp/J/AJ/145/101/` (`table1.dat`
  ~108 KB, 869 galaxies; full 7-table set a few hundred KB). Browse
  frontend: `https://www.sao.ru/lv/lvgdb/` (data updated 2026-04-27).
  CDS standard usage terms.
- **Pace LVDB** — already ingested (`data/local-group/lvdb-snapshot.csv`,
  909 rows, capped at 250 kpc by the LG build). Repo
  `github.com/apace7/local_volume_database`, v1.1.0 (2026-03-21),
  CC0-1.0. `comb_all.csv` ~833 KB. Citation: Pace 2025, OJAp 8
  (arXiv:2411.07424; DOI 10.33232/001c.144859).
  Tier-1 ingest decision deferred to 0hx.3 as specced there: UNGC vs
  uncapped LVDB, keyed on what UNGC adds (structural columns, KLum).
- **SGA-2020** (structural overrides for the wireframe tier) —
  Moustakas et al. 2023, ApJS (arXiv:2307.04888;
  DOI 10.3847/1538-4365/acfaa2). `SGA-2020.fits` ~675 MB from
  `https://sga.legacysurvey.org` (mirror:
  `https://portal.nersc.gov/project/cosmo/data/sga/2020/data`).
  383,620 galaxies, DESI footprint. Do NOT commit the full file —
  the refresh script extracts only the rows matching the wireframe
  list into `data/extragalactic/sga-overrides-input.csv`. Cite both
  SGA and DESI Legacy Imaging Surveys acknowledgments.

### Tier 2 — LSC + Virgo

- **EVCC** — Kim et al. 2014, ApJS 215, 22. CDS
  `https://cdsarc.cds.unistra.fr/ftp/J/ApJS/215/22/` (`table2.dat`
  ~297 KB, 1,589 galaxies; `table3.dat` adds 1,183 VCC-only).
- **2MRS** — Huchra et al. 2012, ApJS 199, 26 (arXiv:1108.0669).
  44,599 galaxies, Ks ≤ 11.75, 97.6% complete all-sky. Primary
  tarball `http://tdc-www.harvard.edu/2mrs/2mrs_v240.tgz` (~37.7 MB)
  — **HTTP only** (see flags). Alternative: CDS `J/ApJS/199/26`
  `table3.dat.gz` (~3.4 MB) carries the catalogue proper; prefer CDS.

### Tier 3 — Laniakea

- **Cosmicflows-4** — Tully et al. 2023, ApJ 944, 94
  (arXiv:2209.11238; DOI 10.3847/1538-4357/ac94d8). 55,877
  galaxies/groups with distances (38,065 groups). EDD web export
  (`https://edd.ifa.hawaii.edu`, table "CF4 All Groups") or VizieR
  mirror `J/ApJ/944/94`; prefer VizieR (scriptable). Tens of MB max.
  PGC-keyed.
- **Dupuy & Courtois 2023 watersheds** — A&A 678, A176
  (arXiv:2305.02339; DOI 10.1051/0004-6361/202346802). NOT on
  VizieR/Zenodo; hosted at
  `https://projets.ip2i.in2p3.fr/cosmicflows/` —
  `CF4_new_128-z008_watersheds-fits.zip` (~64 MB): a 128³ voxel grid
  integer-labelled by basin (1 = Laniakea, 2 = Apus, …), FITS. The
  refresh script converts basin boundaries → line-segment shell
  meshes at build-input time (marching over label transitions);
  commit the derived shell meshes, not the 64 MB grid.

### Tier 4 — cosmic web

- **NED-LVS** — Cook et al. 2023, ApJS 268, 14 (arXiv:2306.06271;
  dataset DOI 10.26132/NED8). FITS from
  `https://ned.ipac.caltech.edu/NED::LVS/fits/AsPublished/` (~1 GB).
  **Pin the version**: the live file grows (2.10M objects as of
  2026-04-24 vs 1.9M at publication). Record the downloaded version
  date in the data README; refresh is a deliberate re-pin.
- **SDSS Main Galaxy Sample** — no standalone MGS file exists. Route:
  CasJobs SQL (`https://skyserver.sdss.org/CasJobs/`) extracting
  ~700k galaxy rows (class GALAXY, sdss_main target flags, z ≤ 0.3;
  columns ra, dec, z, petroMag_r) rather than the 6.7 GB
  `specObj-dr17.fits`. Citation: Abdurro'uf et al. 2022, ApJS 259, 35
  (DR17); selection per Strauss et al. 2002, AJ 124, 1810.

### Tier 5 — BOSS/eBOSS

- **eBOSS DR16 LSS catalogues** — Ross et al. 2020, MNRAS 498, 2354
  (arXiv:2007.09000). Direct HTTPS listing:
  `https://data.sdss.org/sas/dr16/eboss/lss/catalogs/DR16/`. Files:
  `eBOSS_LRG_full_ALLdata-vDR16.fits` (~196 MB, 377,458 combined
  LRG z's), `eBOSS_ELG_full_ALLdata-vDR16.fits` (~189 MB),
  `eBOSS_QSO_full_ALLdata-vDR16.fits` (~434 MB, 343,708 z's), plus
  `.sha1sum` manifest. Random/clustering variants not needed. Commit
  only the extracted (ra, dec, z, class, weights) columns.

### Tier 6 — CMB

- **Planck 2018 SMICA** — Planck Collaboration 2020, A&A 641, A1
  (arXiv:1807.06205). `COM_CMB_IQU-smica_2048_R3.00_full.fits`
  (~1.92 GB, Nside 2048, 50,331,648 pixels) from IRSA
  (`https://irsa.ipac.caltech.edu/data/Planck/release_3/all-sky-maps/`)
  or ESA PLA. The refresh script degrades to **Nside 512** (per the
  epic's size decision) and emits the temperature-anomaly texture;
  commit the degraded product (~50 MB), never the 2 GB source.

### Name / structure services (cross-tier)

- **HyperLEDA** (PA / axial ratio / T-type bulk source) — Makarov
  et al. 2014, A&A 570, A13. **Deferred**: canonical HTTPS cert
  expired since 2020 (see flags), and Tier 1–2 structural needs are
  covered by UNGC + EVCC + SGA-2020 overrides. Revisit only if a
  tier's T-type coverage proves insufficient.

## 2. Cosmology — Planck 2018, baked at build

**Decision**: flat ΛCDM, Planck 2018: H0 = 67.4 km/s/Mpc,
Ωm = 0.315, ΩΛ = 0.685 (Ω_r = 9.2e-5 included in the integrand —
negligible below z ~ 10, cheap to keep exact).

z → comoving distance is **numerically integrated in the build
pipeline** (never at runtime): D_C(z) = (c/H0) ∫₀^z dz′/E(z′),
E(z) = √(Ωm(1+z)³ + Ω_r(1+z)⁴ + ΩΛ). Trapezoidal at Δz = 1e-4 is
far below data uncertainty. The integrator lives once in
`scripts/extragalactic/cosmology-pure.ts` with vitest pins (e.g.
D_C(0.1), D_C(0.7), D_C(1089.9) ≈ 14.0 Gpc for the CMB shell — pin
the integrator's own output with `toBe` at impl time, per § Test
coverage at write time).

Below Tier 3 (z ≲ 0.035), catalogue distances (TRGB/SBF/CF4) are used
directly — cosmology conversion applies only where redshift IS the
distance (Tier 4+, per the epic's accuracy table). Peculiar-velocity
corrected distances are used as published by each catalogue; we never
apply our own flow model.

## 3. Manifest schema

### Common per-galaxy record

| Field | Type | Notes |
| --- | --- | --- |
| position | 3 × float32, ICRS heliocentric pc | float32 = ~7 sig figs → ~100 pc grid at 1 Gpc, far below data uncertainty; render-side precision is handled camera-relative (see § 7) |
| distance | float32 pc | redundant with ‖position‖ but kept: LOD banding + fade tests read it without a sqrt |
| m_k | float32 | apparent Ks; M_K derivable with distance. NaN when the tier has no K photometry (SDSS/BOSS: r-band or class-uniform proxy, documented per tier) |
| morph_t | int8 | de Vaucouleurs T (−5…10); 42 = QSO sentinel, 127 = unknown |
| name_idx | uint16 | index into the tier's name table; 0xFFFF = unnamed |
| pgc | uint32 | 0 = none |
| tier | uint8 | 1–6 source tier |

### Container by tier

- **Tier 1–2: JSON** (`public/local-volume.json`,
  `public/lsc.json`) — same shape as `public/local-group.json` plus
  `morph_t` / `m_k` / `pgc`; small enough (≤ ~10k objects) that
  greppability beats bytes. Wireframe-tier objects additionally carry
  the LG override fields (axes, quat, kind).
- **Tier 3+: binary** (`public/extragalactic/<tier>.bin`) — parallel
  to `catalog.bin` conventions: 4-byte magic + version + uint32
  count header, fixed-stride records per the table above, name table
  appended as length-prefixed UTF-8. Layout constants live once in a
  `*-pure.ts` shared by build script, loader, and tests (never
  redefined — § Named constants and DRY).
- **Tier 4+ chunking**: HEALPix **Nside = 4, nested** (192 sky
  cells) × **4 comoving distance bands** with log-spaced edges
  (Tier 4: 0.2 / 0.45 / 0.7 / 1.0 Gpc; Tier 5: 1.0 / 1.6 / 2.2 /
  3.0 Gpc). File name `chunk_<hpx>_<band>.bin`, one manifest.json
  per tier carrying counts + sha256 per chunk (dust-manifest idiom).
  ~10k galaxies/cell at Tier 4 per the epic's estimate; fetched
  on regime-cross + frustum demand with a ~20-chunk pinned cache
  (dust-loader pattern).

## 4. Naming policy + label ranking

**Labels render only for named objects.** A "name" is a proper name
(Andromeda), Messier, NGC, IC, or UGC designation — harvested from
each catalogue's cross-ID columns at build time, in that precedence
order. **PGC numbers are not names** (they're stored in the record
for cross-referencing, never rendered). Survey IDs (SDSS J…, 2MASX…)
are not names either. Expected named population: ~10k, heavily
concentrated ≤ 30 Mpc.

Label-rank function (extends `computeVisibleLabels` in
`src/client/local-group/local-group.ts`):

- Build-time: named objects only, bucketed into a spatial octree
  (leaf ≈ 50–500 objects).
- Per frame: candidate set = buckets containing + adjacent to the
  camera (~100–500 candidates), ranked by apparent-size-at-camera ×
  tier weight; top-N visible with **hard cap 30 across all tiers
  combined** (LG labels count against the same cap — one ranking
  pass, one `visibleLabelIds` set).
- **1-pixel hysteresis** on rank boundaries (an object must beat the
  incumbent by ≥ 1 px of projected size to displace it) so labels
  don't flicker at rank ties.
- Existing LG behaviour is the degenerate case (one bucket, 52
  objects) — migration must not change today's visible-label set at
  Sol (pin in tests).

## 5. Morphology → colour

**Decision: 6-bucket LUT keyed on de Vaucouleurs T**, following the
Buta/de Vaucouleurs convention the epic names (ellipticals warm/red,
late spirals blue):

| Bucket | T | sRGB anchor |
| --- | --- | --- |
| E | −5…−3 | 255, 224, 187 (warm) |
| S0 | −2…0 | 255, 236, 209 |
| Sa/Sb | 1…3 | 244, 240, 224 |
| Sc | 4…6 | 219, 233, 244 |
| Sd/Sm | 7…9 | 196, 222, 255 |
| Irr / unknown | 10 / 127 | 209, 216, 232 (neutral-cool) |

Continuous T→RGB interpolation rejected: T is itself bucketed in the
source catalogues and a 6-entry LUT is trivially tunable in the debug
panel. QSO sentinel (T = 42) ignores the LUT — Tier 5 colours by
redshift (0hx.7's remit). Anchors are starting values; visual
calibration at impl time against SDSS colour-composite intuition
(ellipticals visibly warmer than spirals at a glance).

## 6. Tier 5 selection bias

BOSS/eBOSS is a *targeted* survey, not a flux-limited census: LRGs
(massive red, 0.6 ≲ z ≲ 1.0), ELGs (blue star-forming, 0.6–1.1), QSOs
(0.8–2.2+), each with its own angular footprint and n(z). Rendering
the union as "the universe at z ~ 0.7" would misrepresent — the
visible structure is partly the selection function.

**Decisions**:

- Render honestly per the data-fidelity principle: every object at
  its catalogued position, uniform per-class brightness, coloured by
  redshift. No completeness re-weighting of brightness (that would
  invent luminosity we didn't measure).
- The published per-object weights (WEIGHT_SYSTOT × WEIGHT_CP ×
  WEIGHT_NOZ) are carried through the pipeline into the binary
  record (replacing `m_k`, which Tier 5 lacks) so a debug-panel
  **selection-function heat toggle** can visualise density
  corrections without a data rebuild. The toggle itself is a low-P
  follow-up under 0hx.7, not a gate.
- The tier's data README documents the three target classes, their
  z-ranges, footprints, and the "structure ≠ selection" caveat, and
  cites Ross et al. 2020 § 2 for the selection definitions.

## 7. Architecture sketches (impl in 0hx.2 / 0hx.3)

1. **Camera regime enum** (0hx.2) — `CameraRegime` STELLAR /
   GALACTIC / SUPERCLUSTER / COSMIC with per-regime
   `{near, far, maxDistance}`; regime chosen by camera distance from
   Sol with hysteresis. **Cutoffs confirmed as specced in 0hx.2**
   (STELLAR far 5e5 → GALACTIC 3e6 → SUPERCLUSTER 3e8 → COSMIC 2e10
   pc), with one gate: the log-depth + reverse-z precision smoke at
   COSMIC near/far ratios decides whether COSMIC near rises above
   1e3 pc. Distance formatting gains Mpc/Gpc + Mly/Gly branches;
   fade bands become a builder (`FadeBand(inner, outer)`).
2. **Galaxy billboard pipeline** (0hx.3, re-fed by .4–.7) — instanced
   quads parallel to the star pipeline, shading via
   `perceptual-disc.glsl`; per-instance position/m_k/morph_t/size.
   Positions are stored absolute ICRS pc (float32) but uploaded
   camera-relative: CPU-side float64 subtraction of the camera
   position per rebase, the star pipeline's floating-origin trick
   lifted to galaxies. Tier 4+ adds the chunk loader (§ 3) and the
   near-billboard/far-volumetric LOD split the epic describes.
3. **Label rank with spatial bucketing** (lands with 0hx.3, extended
   per tier) — § 4 above.

New client code lands in `src/client/extragalactic/` (day-1 folder
with README; loaders/renderers/`*-pure.ts`/tests), with per-tier
build scripts under `scripts/extragalactic/` + one-off
`scripts/refresh/refresh-<tier>.ts` fetchers.

## Access flags (verified 2026-07-06)

- **2MRS** primary host `tdc-www.harvard.edu`: HTTPS cert mismatch —
  use `http://` or prefer the CDS mirror.
- **HyperLEDA** `leda.univ-lyon1.fr`: HTTPS cert expired 2020;
  HTTP redirects to mirror `atlas.obs-hp.fr/hyperleda/`. Deferred
  from v1 (§ 1).
- **Dupuy & Courtois watersheds**: only source is the IP2I
  CosmicFlows page (no VizieR/Zenodo record) — treat as fragile;
  commit the derived shells promptly.
- **NED-LVS**: live file is a moving target — pin + record version
  date (§ 1).
- **SDSS MGS**: no standalone file; CasJobs extraction required (§ 1).
- **CDS FTP** intermittently sits behind an anti-bot wall for
  non-browser agents; the refresh scripts should set a UA and fall
  back to VizieR's TSV export endpoints.
