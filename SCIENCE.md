# Science — sources, formulas, and modelling decisions

This file is the canonical record of every external dataset that goes
into Stellata, the physics that's applied to it at build and render
time, and the deliberate simplifications made along the way. It serves
two audiences:

- **Claude Code sessions** — when adding or changing anything science-driven,
  read this first to understand the sources, the model in use, and what
  has been explicitly ruled out.
- **Human readers** — a self-contained reference describing what's
  scientifically grounded in the visualisation, and where the simplifications
  live.

Implementation details live in the docs under `docs/`; this file points
into them where relevant.

## Scope principles

Three overarching principles govern how the model is built and which
detail is in scope at which range. Every individual modelling decision
below should be consistent with these.

### Data fidelity — "best possible model based on current observational data and knowledge"

Stellata is a physical-accuracy project, not a stylised visualisation.
The catalog grows in well-defined releases (Gaia DR4 expected late 2026,
periodic AT-HYG refreshes), not continuously, so one-time data-
processing investment pays off forever. There is no manual review path
— 300k+ stars cannot be hand-checked, so the data-processing
infrastructure itself has to be correct.

When scoping data-processing / cross-match / catalog-ingest work:

1. **Default to the hard upfront generalised solution, not a famous-
   star carve-out + heuristic fallback.** The "tier just beyond the
   famous ones" is always the trap — solve the class of problem, not
   the visible exemplars. If "the system would need 20 hand-curated
   overrides" the system is wrong, not the data.
2. **Prefer official source-ID cross-walks** (HIP numbers, Gaia source
   IDs, NSS catalogs, SIMBAD identifiers) over position-based matching
   when the cross-walk exists. Position-based matching is the fallback,
   not the primary strategy.
3. **Hand-curated overrides** (e.g. `data/local-group/overrides.tsv`)
   are acceptable only for truly singular edge cases where no canonical
   source resolves them, or for objects a catalog excludes by
   construction (M31, M33 in LVDB's `dwarf_all`) — not as a substitute
   for systematic data engineering.
4. **Ship-less-accurate-now vs ship-more-accurate-later: prefer the
   latter for catalog/data work.** UX and rendering polish can iterate;
   the catalog underpinning the model can't be re-shipped without
   re-rendering everything.
5. **All matching/processing must keep working when external catalogs
   upgrade.** When refactoring a cross-match, ask: does this depend on
   hand-tuned values that won't survive a DR4 swap? If yes, the
   refactor isn't done.
6. **Validation matters at scale.** Spot-checking 5 famous stars
   doesn't tell you what's happening at star #150,000. When shipping a
   new processing stage, build a parallel automated check (compare
   against SIMBAD distances for a random sample, etc.) in the same
   change.

### Detail gradient — highest-density measurable info near Earth, simpler model further out

Per-object near, statistical far. When scoping a layer beyond the
AT-HYG catalog reach, prefer statistical / aggregate sources (HiPS-
derived counts, binned populations) over hand-extending per-object
data. Each tier in the catalogue ecosystem (CDS / VizieR / Gaia /
HiPS surveys) earns its keep in a specific distance regime — pick
the one matched to the layer being added rather than the most
familiar.

### Defer detail until zoom affordance

Defer per-object detail rendering (textures, atmospheric haloes,
banding, surface shading, day-night phase, ring systems, exoplanet
bodies) until the user can actually navigate close enough to see it.

Stellata bodies are billboarded discs sized via θ = 2·atan(R/d). At
any host-relative camera distance more than a few thousand body-radii,
every object floor-clamps to the pixel-size minimum and per-detail
differences become invisible. Coding the detail before the user can
perceive it is wasted effort and wasted bundle.

When scoping a new visual layer, ask first: at what camera-to-object
distance is this detail perceptible? If the answer is closer than the
user can navigate to under existing focus + minDistance affordances,
defer the detail until the renderer exposes a closer-zoom affordance
(per-planet detail waits on planet focus; per-exoplanet detail waits
on the exoplanet ingest pass) and ship the layer without it. Don't
reach for shader complexity to compensate for a perceptual constraint
that's better fixed by a camera affordance.

Same logic generalises beyond planets — any catalog object rendered as
a billboarded disc has the same regime: detail beyond a single
representative colour earns its keep only when the user can fly close
enough to see it.

## Data sources

- **AT-HYG v3.3** (stellar catalogue): https://codeberg.org/astronexus/athyg
  — maintained by David Nash. The classic-IDs subset at
  `data/athyg/athyg_33_classic_ids.csv` is what we consume (every star
  carries at least one classical designation: IAU proper name, Bayer,
  Flamsteed, HIP, HD, HR, or Gliese). Licence CC-BY-SA-4.0.
- **GCVS 5.1** (variable-star catalogue + cross-identification):
  http://www.sai.msu.su/gcvs/gcvs/ — Samus et al, Sternberg Astronomical
  Institute. `data/gcvs/gcvs5.txt` (main file) + `data/gcvs/crossid.txt`
  (Hip/HD/Tyc/etc. → GCVS name mappings). Free for research/educational
  use with attribution.
- **Hipparcos CCDM + MultFlag cross-reference**: VizieR
  `I/239/hip_main`, HIP main catalogue. We commit a three-column
  slice (`-out=HIP,CCDM,MultFlag`) as `data/hipparcos/hip_ccdm.tsv`, used as
  the HIP-keyed visual-doubles flag. CCDM links each Hipparcos
  star to the Catalog of the Components of Double and Multiple
  stars (Dommanget & Nys 1994); `MultFlag` is Hipparcos's own
  multiplicity confidence flag. A star is flagged as a visual
  double when both CCDM is non-blank *and* `MultFlag ∈ {C, G, O}`,
  which keeps Hipparcos-confirmed pairs and rejects CCDM-listed
  optical pairs (line-of-sight chance alignments) that Hipparcos
  did not model. Unlike TDSC there is no bright-star saturation
  gap (Sirius, Mizar, Castor, α Cen, Albireo all carry CCDM IDs
  with confirming `MultFlag`).
- **Washington Double Star Catalog (WDS)** + **Sixth Catalog of Orbits
  of Visual Binary Stars (ORB6)**: Mason et al (2001), AJ 122, 3466
  (WDS); Hartkopf, Mason & Worley (2001), AJ 122, 3472 (ORB6).
  Maintained continuously at the U.S. Naval Observatory and Georgia
  State University. Used to recover binary-pair geometry that AT-HYG
  collapses to a single row: visually-resolved separations ρ and
  position angles θ from WDS, full orbital element fits (P, T, e,
  a, i, ω, Ω) from ORB6 for ~4k systems. Raw fixed-width text files
  committed under `data/wds/`, downloaded directly from
  http://www.astro.gsu.edu/wds/:
    - `data/wds/wds_summ.txt` — main summary, ~157k pair systems
      with ρ/θ, component magnitudes, spectral types, HIP/HD
      cross-IDs (`Webtextfiles/wdsweb_summ2.txt`).
    - `data/wds/wds_notes.txt` — notes accompanying the catalog
      (`Webtextfiles/wdsnewnotes_main.txt`).
    - `data/wds/wds_refs.txt` — discoverer codes and references
      (`Webtextfiles/wdsnewref.txt`).
    - `data/wds/orb6_orbits.txt` — orbital elements
      (`orb6/orb6orbits.txt`).
  Field offsets are documented upstream in `wdsweb_format.txt` and
  the ORB6 ReadMe; consulted by `scripts/binaries/build-binaries.py`
  but not committed. Retrieved 2026-05-11. Public-domain
  (U.S. Government work).
- **SIMBAD WDS↔Gaia DR3 cross-identifications** (CDS Strasbourg).
  Curated per-component cross-IDs between WDS pair identifiers
  (`WDS J<id><comp>`) and Gaia DR3 source_ids, drawn from SIMBAD's
  `ident` and `basic` tables. Stage 2 of `scripts/binaries/build-binaries.py`
  uses this as the principled cross-identification path — SIMBAD
  reliably stores Gaia DR3 source_ids per WDS component for the
  well-known multi-component systems (η Cas A/B/C, ξ UMa A/B,
  ζ Cnc A/B/C, α Cen A/B/Proxima).
  Refresh: `scripts/refresh/refresh-simbad-wds-xids.py` runs a
  two-phase TAP pull (WDS identifiers → SIMBAD oids, then oids →
  cross-IDs) and commits `data/simbad/simbad_wds_xids.tsv` (~23k
  components, ~1.2 MB,
  regular git). Public access policy: SIMBAD is open via CDS's TAP
  service at `simbad.cds.unistra.fr/simbad/sim-tap`; cite Wenger et
  al (2000), A&AS 143, 9.
- **Stellarium modern sky culture** (constellation stick figures):
  https://github.com/Stellarium/stellarium/tree/master/skycultures/modern
  — MIT-licensed JSON, HIP-indexed polylines. Committed as
  `data/stellarium/stellarium-modern-skyculture.json`; essentially never changes.
- **Edenhofer 2023 3D dust map** (interstellar extinction + ISM density):
  https://doi.org/10.5281/zenodo.8187943 — Gordian Edenhofer & Greg Green.
  Downloaded via the `dustmaps` Python package and resampled by
  `scripts/dust/build-dust.py` onto a 512³ Cartesian voxel grid in ICRS pc.
  Produces `data/dust/chunk_*.bin` (64 chunks, 128 MiB total, LFS) plus
  `data/dust/particles.bin` (50K importance-sampled dust points, LFS).
  Density in E_ZGR per parsec; A_V/E_ZGR ≈ 2.742 at V band.

> **Molecular cloud sources currently shelved.** Zucker et al. 2020 +
> 2021 cloud distances and 3D bounding boxes drive the molecular-cloud
> ellipsoid layer, which is committed but not currently rendered while
> the visual treatment is being refined. The build script
> (`scripts/clouds/build-clouds.py`) and source files
> (`data/molecular-clouds/`) remain in the repository for the future
> re-enable.

## Stellar catalog ingestion

AT-HYG is not a single survey — it's a heterogeneous merge that David
Nash maintains across Tycho-2 (bulk positions and photometry, ~2.5M
stars complete to V≈11), Hipparcos (the bright end), Gaia DR3 (most
distances and a small fraction of positions), and Gliese (nearby stars).
The classic-IDs subset we consume isn't a population from any one of
those — it's whichever rows from the merge carry at least one classical
designation (proper name, Bayer, Flamsteed, HIP, HD, HR, or Gliese).

**Per-row provenance.** Every row carries four `*_src` columns naming
which underlying catalog supplied each piece of data:

- `pos_src` — origin of `ra`/`dec`. ~99.4% Tycho-2 (`T`), <1% HIP / GJ.
- `dist_src` — origin of `dist` and the derived `x0`/`y0`/`z0`. ~97.9%
  Gaia DR3 (`G_R3`), ~1.2% no distance available (`N`), small remainders
  from HIP / Gaia DR2 / Gliese.
- `mag_src` — origin of apparent `mag`. ~62.5% Tycho-2 V_T (`T`),
  ~37.2% Hipparcos (`HIP`), <1% Gliese.
- `pm_src` — origin of proper motion (we ingest the columns but don't
  apply T-axis animation, so `pm_src` is unused).

The two source families have meaningfully different magnitude
distributions: HIP-sourced rows average `mag ≈ 8.4`, while Tycho-sourced
rows average `mag ≈ 10.2` and reach the Tycho-2 completeness limit at
V_T ≈ 11.5. This matters because rendering decisions like the
`naked-eye` (m_lim = 6.5) preset draw essentially only from the HIP
family, while widening to `binoculars` (10.5) or `all` (15) progressively
exposes the Tycho-dominated population.

**What we keep at build time.** `scripts/catalog/build-catalog.ts` (`readStars`)
applies three filters and nothing else:

1. Drop rows missing `ra`/`dec` or `dist` (no usable 3D position).
2. Drop rows missing `absmag` (can't size or shade them).
3. Drop rows with `dist > 50,000 pc`. This is a **bounded-scope
   statement about which populations the model represents**, not a
   primary include/exclude filter. The cutoff is positioned just past
   the LMC distance (49.59 kpc, Pietrzyński et al. 2019) because the
   stellar populations currently modelled reach from Sol out to and
   including the LMC. Stars beyond LMC depth are unmodelled
   extragalactic by construction; SMC, Sgr dSph, and M31 supergiants
   would be candidates for future modelled populations, and the cutoff
   bumps in sync with each new population the renderer takes
   responsibility for. The filter runs
   **after** the multi-layer distance-refinement stack below, so a
   star that B-J or the LMC kinematic override rescued from a
   catastrophic 1/π estimate keeps its corrected distance whenever
   that distance falls inside scope.

There is no source-aware filtering. The 80-byte v6 binary record
preserves none of the `*_src` columns either, so the renderer can't
distinguish a Tycho-positioned, Gaia-distanced row from a "pure"
Hipparcos one — every star is shaded by the same physical model
(§Stellar physics, §Stellar perception model). v6 does carry each
star's Gaia DR3 `source_id` (when AT-HYG has it) plus Apsis
astrophysical parameters (Teff/logg/[M/H]/A0 from gspphot ∪ gspspec)
keyed by it — the source-ID anchor downstream consumers (cross-match
and Apsis-direct stellar parameters) key off.

**Multi-layer distance refinement.** Three overrides run in fixed order
on every AT-HYG row before the bounded-scope cutoff above fires:

1. **Bailer-Jones (2021) Bayesian posterior** — replaces the catastrophic
   1/π Gaia inverse-parallax estimator for AT-HYG rows whose distance
   was sourced from Gaia DR3 (or DR2) parallax. Targets the noisy
   regime that hosts the brightest, most luminous, longest-baseline
   stars (B/A supergiants, AGB stars), where Lutz-Kelker bias plus the
   sampling distribution's heavy tail push individual estimators by an
   order of magnitude.
2. **LMC kinematic override** — replaces B-J's mis-anchored posterior
   for AT-HYG entries in the LMC field, using a sky-cone + bulk-PM
   identification pinned to Pietrzyński et al. (2019)'s eclipsing-
   binary distance to the LMC's centre of mass.
3. **Bounded-scope cutoff** at 50,000 pc — drops rows still beyond LMC
   depth as unmodelled extragalactic per the framing above.

Ordering is non-commutative. Bailer-Jones runs first because its
posterior is well-calibrated everywhere the Galactic-density prior is
valid; the LMC kinematic layer runs second so it can override B-J on
the ~60 AT-HYG rows where B-J's smooth prior fails (B-J has no LMC).
If LMC ran first, B-J would clobber the kinematic snap back onto its
intermediate-wrong posterior because LMC stars carry Gaia source_ids
that B-J's map covers. The cutoff runs last so it acts on the refined
distance, not the catastrophic input.

Future Magellanic-system or M31 layers will sit alongside the LMC
kinematic layer (same sky-cone + bulk-PM identification pattern,
distinct anchor distances) and bump the cutoff as each new modelled
population enters scope.

**Bailer-Jones DR3 distance override (Layer 1).** AT-HYG's `dist` for
the ~98% G_R3 majority is Gaia DR3's naive `1 / π` parallax inversion —
unbiased only when parallax S/N is high. For low-S/N parallaxes (the
distant luminous stars that dominate the visual scene's outer
volume) the inverse-parallax estimator catastrophically fails:
its sampling distribution has a long tail to large distances, and a
handful of supergiants end up at 9–14 kpc instead of their true
2–5 kpc. Bailer-Jones et al. 2021 (*AJ* 161, 147,
DOI 10.3847/1538-3881/abd806; CDS I/352) publishes Bayesian distance
posteriors for every Gaia DR3 source that combine the parallax
likelihood with a Galactic-density prior; the photogeometric variant
additionally combines the prior with G and BP–RP photometry. The
parallax-zero-point bias documented in Lindegren et al. 2021
(*A&A* 649, A4, DOI 10.1051/0004-6361/202039653) is applied upstream
in B-J's own pipeline, so we consume the posteriors directly without
applying a separate correction. At high S/N the posterior collapses
onto the likelihood (well-measured stars don't move); at low S/N it
collapses onto the prior (catastrophic outliers get pulled back to
plausible disc distances). This is the principled fix and we apply it where
the underlying distance actually is a Gaia inverse-parallax estimate
— i.e. AT-HYG rows whose `dist_src` is `G_R3` or `G_R2`. For those
rows we swap `dist` and `absmag` for the Bailer-Jones-derived values
(photogeometric `r_med_photogeo` preferred, geometric `r_med_geo` as
fallback when photogeo is absent); position follows as the
direction-cascade unit vector × the new distance (§ Driver
astrometry). Recomputing `absmag` matters as much as the distance
update — without it, stars get *placed* at the new distance but
*lit* for the old one, breaking the disc/glow size chain.

Rows whose `dist_src` is `HIP` / `GJ` / `N` / `OTHER` are deliberately
excluded from the override even when they also carry a Gaia DR3
source_id: their catalogued distance is a Hipparcos parallax, a
Gliese–Jahreiß nearby-star value, or a curated entry from another
source, all of which are reliable at the close distances they
typically cover. Overriding them with B-J would be a silent
regression — when the Gaia parallax for a close, bright star has
low S/N (a not-uncommon failure mode for very bright stars in DR3),
B-J's posterior collapses onto its Galactic-density prior tail at
10–40 kpc and pushes a well-known nearby star out by 1–2 orders of
magnitude. The override fires for ~99.5% of Gaia-inverse-distanced
AT-HYG rows; the residual 0.5% are source_ids absent from the
Bailer-Jones publication and keep their AT-HYG values. The override
also rescues ~15 stars previously dropped at filter (3): catastrophic
parallax inversions whose Bayesian distance is < 50 kpc.

Data file: `data/bailer-jones/bailer-jones-dr3.tsv` (~310k rows,
refreshed by `scripts/refresh/refresh-bailer-jones.py`).

**Distance-override validation against Vaidman et al. 2025.** Vaidman,
Khokhlov, Miroshnichenko, Agishev & Yermekbayev 2025 (*Universe* 11, 359;
DOI [10.3390/universe11110359](https://doi.org/10.3390/universe11110359))
publish a Bayesian recalculation of Gaia DR3 distances for 132 Galactic
BA-type supergiants — exactly the failure-mode population the Bailer-Jones
override above is designed to rescue. The paper's appendix tables list
their adopted distance per star together with Bailer-Jones's
`r_med_photogeo` (their direct comparand) and the parallax SNR each
decision rode on, an independent third-party reference set we use to
spot-check the override on a recurring basis.

The 132 rows live under CC BY 4.0 at
`data/distance-validation/vaidman-2025-supergiants.tsv` (provenance and
SIMBAD name-resolution recipe in `data/distance-validation/README.md`);
`scripts/distance-validation/validate-distances.py` runs the comparison
end-to-end and reports the per-star fractional difference distribution
(median, 84th-pct, and top-5 disagreements) against the override's
Bailer-Jones input. The harness is built to re-run on every distance-
source change — a DR4 Bailer-Jones refresh, a switch to StarHorse or a
B-J successor, or any change to `build-catalog.ts`'s distance-priority
logic — so each migration gets a calibrated named-disagreements report
rather than a "trust the diff" sign-off.

**LMC kinematic distance refinement (Layer 2).** Bailer-Jones's
Galactic-density prior has no LMC — so for AT-HYG's ~60 LMC
supergiants (HDE 268xxx range), the posterior peaks somewhere
intermediate (5–20 kpc) instead of the LMC's true ~50 kpc. Without a
second layer this regresses today's behaviour: a "line of stars
between MW and LMC in the intergalactic void". After the B-J override
fires we run a population-specific second pass: any row inside a 15°
cone of the LMC photometric centre (RA 78.76°, Dec −69.19°) whose
proper motion lies within ±0.5 mas/yr of the LMC bulk centre-of-mass
PM (van der Marel & Kallivayalil 2014, *ApJ* 781, 121,
DOI 10.1088/0004-637X/781/2/121: +1.85 mas/yr in RA, +0.20 mas/yr in
Dec) has its `dist` snapped to the LMC's eclipsing-binary distance
(49.594 kpc, Pietrzyński et al. 2019, *Nature* 567, 200,
DOI 10.1038/s41586-019-0999-4; CDS J/other/Natur/567.200), with
`absmag` recomputed from the new distance. ~54 rows are
flagged at LMC depth each build — close to the ~60 estimated from the
AT-HYG/Gaia source data. SMC, Sgr dSph, and other Magellanic-system
populations are too faint for AT-HYG's brightness cut today; the same
approach will extend when DR4 lands or AT-HYG goes deeper.

**Astrophysical parameters from Gaia DR3 Apsis.** Apsis is Gaia DR3's
astrophysical-parameters pipeline (Creevey et al. 2023, *A&A* 674,
A26, DOI 10.1051/0004-6361/202243688). It publishes two independent
solutions per source: `gspphot` (photometric fit to BP/RP spectra +
parallax — Andrae et al. 2023, *A&A* 674, A27,
DOI 10.1051/0004-6361/202243462) and `gspspec` (spectroscopic fit to
RVS spectra — Recio-Blanco et al. 2023, *A&A* 674, A29,
DOI 10.1051/0004-6361/202243750). Each emits (T_eff, log g, [M/H]);
gspphot additionally emits `A0` (line-of-sight monochromatic
extinction at 547.7 nm) and gspspec additionally emits a coarse
spectral-type enum (`O`, `B`, `A`, `F`, `G`, `K`, `M`, `CSTAR`,
`unknown`).

Stellata pulls all seven Apsis floats plus the gspspec spectral-type
enum per Gaia DR3 source_id into `data/gaia/gaia_dr3_apsis.tsv` and
writes them per record into the v6 binary at offsets 52–79 (see
`scripts/README.md` § Binary catalog format). Coverage: ~99.6% of
AT-HYG rows that resolve to a Gaia DR3 source_id match an Apsis row;
~85% have a non-null T_eff in at least one of gspphot or gspspec. That
last number is the population the renderer's colour LUT path can re-
key from the Ballesteros (2012) B-V relation to Apsis-direct T_eff;
the ~15% gap (typically faint Tycho-only stars without high-S/N BP/RP
photometry, plus hot O/B stars where gspphot doesn't converge) falls
back to spectral-class T_TABLE.

Three downstream paths consume Apsis directly:

- **Stellar colour calibration** uses Apsis T_eff as the intrinsic
  temperature when available — see §Star colour calibration §Per-star
  intrinsic Teff routing for the six-tier resolver and why Apsis
  beats Ballesteros(B-V) here (gspphot fits include `A0` explicitly,
  so dust reddening composes downstream without double-counting
  extinction).
- **Spectral classification fall-through** uses gspspec's
  `spectraltype_esphs` enum as the second tier after SIMBAD sp_type.
  Letter-only — no subclass or luminosity class — but anchors the
  colour ramp where SIMBAD missed.
- **Future multi-star refinements** (mass-ratio refinement for giants
  using direct log g; geometric occlusion photometry using direct
  T_eff for limb-darkening) read the per-record Apsis floats without
  a binary-version bump.

A `NaN` cell at any of the seven Apsis float offsets is the canonical
absent sentinel; consumers test with `Number.isNaN(x)`.

**Known cross-match completeness artefact.** Filter (1) above is the
load-bearing one: AT-HYG can only emit `x0`/`y0`/`z0` for a Tycho-2
star when that star's Gaia DR3 distance lookup succeeded, and Gaia DR3's
crossmatch success rate is *spatially non-uniform* — Gaia scans the sky
in great-circle strips with overlapping caustics, and DR3's footprint
has visible cutoffs along the ecliptic plane. The result is that
contiguous patches of Tycho-2 stars get distances (and survive into our
binary) while adjacent patches don't. Those boundaries surface in the
rendered scene as axis-aligned rectangular regions of denser, fainter
stars — invisible at `maxAppMag` ≤ ~9 (the Tycho-mag population is
filtered out anyway), increasingly obvious from there to `all` at
mag 15. A denser future ingest from the same AT-HYG pipeline will likely
make the rectangles *more* prominent before they smooth out, since the
Tycho+Gaia-DR3 composite rows are the bulk of the new population.
Treatment (filter by source, wait for Gaia DR4, or live with it) is
deferred until a denser-than-mag-11 ingest makes the call necessary.

Implementation: `scripts/catalog/build-catalog.ts` (filters live in `readStars`,
binary schema in the `pack*` helpers); see `scripts/README.md` for
the per-record byte layout and the GCVS / CCDM cross-match passes that
run after the AT-HYG read.

### Driver astrometry — AT-HYG precision findings and the direct-sourcing decision

Research record (2026-07) answering: should per-star positions come
from HIP2 + Gaia DR3 directly rather than AT-HYG's tabulated columns?
Trigger: AT-HYG stores `x0`/`y0`/`z0` at ~3 decimal places (a 0.001 pc
≈ 206 AU grid), which put Sirius A and B ~100 AU apart across two
pipelines that had derived the same star from different columns.

**Finding 1 — the truncation is upstream formatting of derived
columns, and it is not the real problem.** The classic-IDs subset
carries field values identical to the full AT-HYG (upstream
`data/subsets/README.md`), so the truncation is AT-HYG's own
tabulation, not our subsetting. The same rows print `ra`/`dec` at 8
decimal places and `dist` at 4 (a 1e-4 pc ≈ 20.6 AU radial grid);
1,901 of the 1,903 HIP-distanced rows reproduce `dist = 1000/plx`
from the van Leeuwen HIP2 file we already commit, to the printed 4 dp
exactly. Full-precision *columns* are therefore recoverable without
any new data source. The real problem is provenance, below.

**Finding 2 — AT-HYG's `x0/y0/z0` is internally inconsistent with its
own printed `ra`/`dec`, tangentially, in proportion to proper
motion.** Recomputing xyz from each row's printed (ra, dec, dist) and
comparing against the stored xyz: ~6% of rows disagree beyond the
combined column-rounding bound. The residual is almost purely
tangential (radial medians sit below the dist-column quantum) and
scales with the row's PM — the implied time offsets spread broadly
(quartiles ≈ 11–31 yr), so this is a position-source mismatch, not a
single epoch bug. Worst cases reach tens of arcsec: 40 Eridani (Keid,
5 pc, PM 4.1″/yr) is ~20″ inconsistent *within its own row*. Direct
comparison against Gaia DR3 5p positions (local
`gaia_dr3_astrometry.tsv`, J2016 back-propagated to J2000) shows the
stored xyz is ~1.5″ (median, high-PM rows) from Gaia truth as well —
the xyz column matches no single (source, epoch) pair we tested. It
is a merge artifact without recoverable provenance. Corroborating:
the multiple-star pipeline independently found AT-HYG's printed
ra/dec to be mixed-epoch (HIP-sourced rows empirically at J1991.25,
Tycho/GJ rows near J2000 — `scripts/binaries/README.md` § Stage 2).

**Finding 3 — the current build splits the catalogue into two
position regimes, and the bright famous stars are in the worse one.**
The Bailer-Jones override already recomputes xyz from printed ra/dec
for the ~310.4k rows it fires on, so those carry Tycho-2-grade
(~10–100 mas), mixed-epoch tangential positions at full column
precision — including, for high-PM stars, silently *replacing* the
stored xyz with a position up to arcsec-different. The 2,888 rows the
override skips (`dist_src` HIP / GJ / G_R2-without-B-J) keep the raw
~206 AU-grid xyz — and that set is exactly the Gaia-saturated bright
population: 116 stars brighter than mag 3, including Sirius, α Cen,
Vega, Capella, Procyon, Betelgeuse, and nearly every multi-star
showcase system.

**Precision floor.** Stated per viewing distance (closest realistic
viewpoint, not Sol — a camera can sit inside any of these systems):

- *Per-component multi-star placement* (camera at ~0.005 pc): the
  binding requirement is **consistency** — every pipeline must derive
  a star's position from the same source, epoch, and math, or
  companions land ~100 AU from their primaries as Sirius did.
  Absolute truth is bounded by measurement error anyway (HIP2's
  σ_plx = 1.58 mas on Sirius is ±2,300 AU radially, 1σ); chasing
  absolute AU-accuracy is not meaningful, matching representations is.
- *Tangential accuracy* (pickbox alignment, OBSERVE-mode sky
  positions, PM propagation base): Tycho-2-grade ~1.5″ typical /
  tens-of-arcsec worst-case fails a sub-arcsec pickbox today; Gaia
  5p (~0.02–0.05 mas) and HIP2 (~1 mas) pass with orders of margin.
- *The float32 container is the hard floor.* `catalog.bin` stores
  xyz as float32 parsecs, so absolute-position resolution degrades
  with distance from Sol: ulp ≈ 0.05 AU at 2.6 pc, ~1.6 AU at
  100 pc, ~13 AU at 1 kpc, ~800 AU at 50 kpc. Absolute coordinates
  can never encode 1–100 AU binary geometry beyond ~100 pc, no
  matter how good the source astrometry — per-component placement
  must stay *relative* (sep+PA / orbital elements anchored on the
  primary record, as companion promotion already does). Source
  precision beyond ~1 mas buys nothing the container can keep.

**Decision — re-source the direction, keep AT-HYG as the driver,
keep the distance stack. Implemented in
`scripts/catalog/direction-cascade.ts`.** AT-HYG remains the
membership, identifier, name, and magnitude driver (its curated
classical-ID merge is the value; replacing it wholesale re-litigates
membership for no gain — the deep-tier driver question is separate
and stays with the far-catalog work). Each row's *sky direction* is
resolved at build time through the same trust cascade the
multiple-star pipeline already implements
(`scripts/binaries/stage3_astrometry.py`), sharing its thresholds:

1. **Gaia DR3 5p** (ra, dec at J2016.0, the scene epoch — no
   propagation) for every row that resolves to a source_id with usable
   astrometry — ~310.6k rows (~99.2%), mas-grade or better, including
   ~10k NSS-flagged rows whose `gaia_source` astrometry is the
   centre-of-mass refit.
2. **HIP2 van Leeuwen** (ra, dec at J1991.25, PM-propagated forward to
   J2016.0) for the Gaia-saturated bright set — 2,509 rows with no
   usable Gaia parallax, plus 138 whose Gaia-vs-HIP2 PM disagrees by
   > 50 mas/yr on either axis (orbit-corrupted 5p PM).
3. **AT-HYG printed ra/dec as-is** for the residual (30 rows,
   including Sol; ξ UMa is the canonical case — no Gaia source,
   HIP 55203 excluded from HIP2 as orbit-corrupted). Mirrors
   Stage 3's `athyg_position`.

Distances are untouched: the Bailer-Jones → LMC-kinematic → cutoff
stack above stays the radial source of truth, with HIP rows keeping
their HIP2-parallax distances (computed from the committed file at
full precision rather than AT-HYG's 4 dp print — same values, gated
on actually reproducing the printed value: HIP 57146's
unresolved-binary HIP2 refit at 187 ± 37 mas / gof 99 is the one
row where blind substitution would have moved a curated 59.9 pc
star to 5.3 pc). Every row's xyz is `direction × distance` computed
in float64 and written float32; the stored `x0/y0/z0` columns are
no longer consumed. Both build pipelines derive every shared star
from the same astrometry files, closing the consistency gap by
construction. **J2016.0 is the scene epoch** — Gaia DR3's native epoch,
adopted catalogue-wide (`data/README.md` § Reference epoch) so the
Gaia-dominant corpus needs no propagation and only the shrinking HIP2 /
AT-HYG minority advances; the binary pipeline mirrors the same
`CATALOG_SCENE_EPOCH` in `scripts/binaries/stage6_multiples.py`. Epoch
propagation is the RV-free linear space-motion form (tangent-basis
advance + renormalise): exact in cos δ, <0.002″ error at Barnard's-scale
PM over the 24.75 yr HIP2→J2016 interval (Gaia routes are a zero-Δt
no-op); perspective acceleration (≤0.15″ worst case) is deferred to
current-epoch propagation, which consumes the same resolved (position,
PM, RV, parallax) tuple and composes on top of this cascade.

The sky-position regression corpus
(`scripts/catalog/sky-position-corpus.tsv`) pins Barnard's,
Kapteyn's, Groombridge 1830, 61 Cyg A/B, and Keid (Gaia tier-1) plus
Sirius and Vega (tier 2, HIP2-propagated 24.75 yr) against their
J2016.0 positions, and ξ UMa's tier-3 printed position. At the J2016.0
scene epoch the Gaia tier is a zero-Δt no-op, so it is a
placement/tier-routing pin; the propagation formula (tangent / sign /
cos δ) is exercised by the HIP2 tier and pinned independently against
SIMBAD J2000 in `direction-cascade.test.ts`. Gaia DR4 slots in as a
source-file swap inside the same cascade (`scripts/refresh/README.md`
§ DR4 transition).

### Current-epoch star positions — space-motion propagation to `t`

Design record (2026-07) answering: how do catalog stars leave the
J2016.0 snapshot and track the scene's time base `t`, the way
planets and binary orbits already do? The time readout claims the
scene renders "the moment being rendered"; today that claim holds
for the solar system and binary orbital motion but not for the
~322k catalog star positions, which sit frozen ~10 years stale. The
error is concentrated exactly in the stars users recognise and
focus on — the high-PM nearby neighbours (drift table:
`data/README.md` § Reference epoch and proper motion; worst case
Barnard's Star at ~1.8 arcmin from the J2016.0 base).

**Position baseline.** Post-direction-cascade (§ Driver astrometry
above), every record's position is J2016.0 *by construction* — Gaia
DR3 5p at its native J2016.0 (no propagation), HIP2 propagated
J1991.25 → J2016.0, or AT-HYG printed ra/dec as-is for the 30
residual rows (including Sol). The old "AT-HYG says J2000 but HIP
rows are empirically J1991.25" ambiguity is resolved upstream of
this design; propagation starts from a clean epoch. This runtime
advance therefore starts from J2016.0, not J2000.0.

**Velocity sources.** Route per row through the same trust cascade
the direction resolution uses, so position and velocity always come
from the same solution:

1. **Gaia DR3 5p PM** (`pmra` = μ_α*, `pmdec`, mas/yr) — on 311,129
   of the 315,050 pulled source_ids (98.8%);
   `data/gaia/gaia_dr3_astrometry_catalog.tsv` already carries the
   columns.
2. **HIP2 PM** for the rows the cascade routes to HIP2 (2,509
   without usable Gaia parallax + 138 PM-discrepant) —
   `data/hipparcos/` van Leeuwen columns already committed.
3. **AT-HYG `pm_ra`/`pm_dec`** (mas/yr, 98.9% coverage,
   merge-artifact provenance) for rows with neither, else **zero**.
   Rows with no PM from any source stay at J2016.0 — that residual
   is a few hundred faint distant stars whose drift is
   sub-arcsecond per century, plus Sol, which carries no PM row and
   so correctly stays fixed at the origin; exact per-tier counts
   get pinned in `build-counts` at implementation time.

**Radial velocity requires no new pull.** AT-HYG's `rv` column
(km/s) is non-zero on 267,093 rows (84.2%), and its `rv_src` is
`G_R3` on 258,297 of those — it already *is* Gaia DR3 RVS data,
with small HYG-legacy (7,995) and other (~800) tails. Use it
directly where present, zero otherwise. Adding `radial_velocity`
to the astrometry-catalog refresh schema is a DR4-transition
upgrade, not a prerequisite. RV barely moves the needle visually
(Barnard's −110 km/s changes its distance ~0.6% per century) but
costs nothing to include, and matters at scrubber timescales.

**Propagation math.** Linear space motion in the equatorial
Cartesian frame `catalog.bin` uses:

```
v   = v_r·û + d·MAS_TO_RAD·(μ_α*·ê + μ_δ·n̂)     [pc/yr]
p(t) = p(J2016) + v·(t − 2016.0)                  [pc, t in Julian yr]
```

with `û` the unit direction, `ê`/`n̂` the local east/north tangent
basis (the same basis `directionAtEpoch` in
`scripts/catalog/direction-cascade.ts` assembles — second usage,
so the basis math extracts into a shared helper), `d` the final
stack distance, and `v_r` in pc/yr via 1 km/s = 1.0227×10⁻⁶ pc/yr.
μ_α* is the cos δ-applied rate — never divide by cos δ. This is the
standard epoch-transformation model (ESA SP-1200 Vol. 1 § 1.5.5;
Butkevich & Lindegren 2014, A&A 570, A62 give the rigorous form).
Deliberately omitted: perspective acceleration and light-time
terms. The perspective term is the largest omission and grows
quadratically — from the J2016.0 base it is ~0.07″ at J2026 for
Barnard's (the worst case), far below the 1″ validation tolerance;
~10 arcmin at ±1 kyr. Linear
propagation is therefore faithful at arcsecond fidelity for
decades and at arcminute fidelity for ~±1 kyr on the fastest
stars (far longer for everything else); a future deep-time
scrubber that exceeds that window revisits with the rigorous
model, alongside the Standish ephemeris window it already has to
respect.

**Decision — runtime propagation at load-time granularity, not a
build-time epoch bump.** A build-time advance to a fixed epoch
(e.g. 2026.0) was rejected: it goes stale by construction (rebuild
to stay current), still contradicts the time readout, and cannot
compose with the planned time scrubber (`stellata-nmu`). Instead:

- `catalog.bin` v7 appends per-record `vx/vy/vz` `float32` pc/yr
  (bytes 80–91, stride 80 → 92; +3.9 MB ≈ +15%). Positions stay
  J2016.0 — the scene epoch convention and every existing
  regression corpus remain valid.
- At startup, immediately after catalog load, one pure pass
  advances `catalog.positions` to `getT()` (float64 math, float32
  write-back; ~322k rows, milliseconds). Every consumer downstream
  — the `iPosition` instance buffer, hover picking, focus/warp
  targets, constellation lines, binaries baselines, eclipse
  photometry — inherits current-epoch positions *coherently by
  construction*, with zero per-frame cost and zero shader change.
- Within-session drift with `t` pinned to now is invisible: the
  fastest star moves ~0.001″/hour. No re-advance machinery needed
  until the scrubber exists. When it does: re-run the pass when
  `|t − t_advanced|` exceeds a sub-pixel drift threshold
  (bucketised, same idea as the ephemeris 60 s cache); a per-frame
  GPU path (per-instance velocity attribute) stays available as an
  escalation and reads the same v7 columns, but is not needed for
  v1.

**Time base.** `Stellata.getT()` → Julian epoch years via
`(JDE − 2451545.0) / 365.25`. Single source of truth — never
`Date.now()` (`docs/authoring-patterns.md` § Single source of
truth).

**Composition with binary orbital motion.** Members of a pair get
one shared *systemic* velocity: the barycentric blend
`v_sys = (1−q)·v_primary + q·v_secondary` when both members carry
their own PM (this cancels the orbital contamination in
per-member Gaia PMs to first order — the barycentre is what moves
linearly), else whichever member has one. Promoted companions
inherit `v_sys` in `companion-promotion.ts`. Because both members
advance identically, `BinaryOrbitField`'s relative walk
(`abs[s] − abs[p]`), its per-relation baseline caches, and eclipse
photometry's `baseDiff` are all invariant under the advance pass —
orbital motion stays owned by the Kepler layer with no
double-counting and no field-code change. (This resolves the
anchor-seam question tracked as `stellata-nmu.4`: v1 is the
CPU-baseline scheme at load granularity; the GPU-attribute scheme
remains the documented escalation.)

**Validation.**

- Pure-math vitest: tangent-basis sign conventions (pole-adjacent
  and RA-wrap cases — the ecliptic-pole sign-flip bug class),
  mas/yr and km/s unit conversions pinned with `toBe`.
- Current-epoch corpus: Barnard's (HIP 87937), Kapteyn's
  (HIP 24186), Groombridge 1830 (HIP 57939), 61 Cyg A/B, Proxima
  (HIP 70890), Lacaille 9352 propagated to a fixed test epoch and
  pinned ≤1″ against published positions (SIMBAD/Gaia propagated
  to the same epoch), driving the same pure advance function the
  runtime uses — the natural extension of the sky-position corpus
  (`scripts/catalog/sky-position-corpus.tsv`) to a second epoch.
- Systemic-velocity invariant: for every `has_orbit` pair,
  `v_primary === v_secondary` exactly.
- `build-counts`: per-tier velocity-source routing counts pinned.
- Manual smoke: focus Barnard's Star, compare OBSERVE-mode sky
  position against a current-epoch chart.

## Stellar physics

**Physical radius.** Each star's `physicalRadius` (in solar radii) is
computed at build time via Stefan–Boltzmann, given the absolute
magnitude and parsed spectral class:

```
T       = interp(T_TABLE[classIdx], subclass)
BC      = interp(BC_TABLE[classIdx], subclass)
Mbol    = absmag + BC
L/L☉    = 10^((4.74 − Mbol) / 2.5)
R/R☉    = sqrt(L/L☉) × (T_sun/T)²
```

T and BC tables are main-sequence values — cooler for giants/supergiants
in reality — but the Mbol side of the equation absorbs the
luminosity-class difference, so the end result lands close to published
radii (Sol≈1.03, Sirius≈1.81, Vega≈2.68, Rigel≈75, Betelgeuse≈700, all
within ~10% of canonical values). Clamped to `[0.08, 2500]` so
pathological catalog rows don't produce absurd sizes. White dwarfs are
special-cased to 0.013 R☉ (typical WD radius; absmag doesn't translate
reliably for them).

Implementation: `scripts/catalog/build-catalog.ts`, see
`scripts/README.md` §Physical radius and spectral parsing for the
spectral-string parser and the surrounding pipeline.

## Stellar perception model

Distant stars (the brightness-driven `appSize` term) are rendered with
a Gaussian-PSF detection-threshold model rather than a literal angular
mapping. A real star is geometrically a point; what an observer
perceives as the star's "disc" is its PSF on the retina out to where
the intensity drops below the detection threshold. For a Gaussian PSF
of width σ this gives:

```
r_perceived(Δm) = σ × √(2 ln(10) / 2.5 × Δm) ≈ σ × √(1.84 × Δm)
```

where Δm = m_lim − m is the magnitudes by which a star sits above the
detection threshold.

**σ value.** We use σ = 30″ for the unaided eye (set by ocular
aberrations + diffraction at a 7 mm dark-adapted pupil). No atmospheric
seeing, no spike-rendering — the camera is in space and we model a
clean PSF.

**Magnitude limits per preset.** `naked-eye` = 6.5 (Bortle-1 dark sky);
`binoculars` = 10.5 (typical 7×50 dark sky, derived from
m_lim_eye + 5·log₁₀(50/7) ≈ +4.3 mag aperture gain); `all` = 15
(matches the catalog/UI slider ceiling, no physical motivation).

**Exaggeration K.** Literal physics at 50° vertical FOV / 1080 px
puts the threshold disc at ~0.25 px and Sirius (Δm = 8) at ~1 px —
both invisible. `starExaggerationK` scales σ up so the threshold disc
lands at a readable 1–2 px. K is per-preset because the population
mix changes with the magnitude limit: defaults are `naked-eye` 12,
`binoculars` 9, `all` 5 — wider catalogs use a smaller K so the dense
star population doesn't wash the field out. Critically, the √Δm shape
is preserved between stars within a preset, so *ratios* against the
volumetric Milky Way bulge (rendered at its real angular size) stay
correct.

**Soft taper.** Real stars near the detection threshold fade across
~0.5 mag rather than popping at the limit. The shader extends
visibility to `m_lim + 0.5` and fades glow intensity via a smoothstep
across that band; the disc pass keeps the hard limit since resolved
discs at threshold would render as a sub-pixel speck.

**Viewport calibration.** Sizes are stored in arcsec internally and
converted to pixels per-frame via
`arcsec_per_px = (FOV × 3600) / max(viewport_w, viewport_h)`. Using
the larger viewport dimension as the reference gives consistent
absolute pixel sizes across portrait/landscape orientations, at the
cost of strict angular fidelity in the secondary axis. Three.js's
`camera.fov` is the *vertical* FOV; horizontal arcsec/px would be
identical only for square viewports.

Implementation: `src/client/star-pipeline/star.{vert,frag}.glsl` (`sqrt`
brightness curve + smoothstep taper) and `src/client/stellata.ts`
(`MAG_PRESETS`, `applyMagnitudePreset`, `computePresetPxSizes`).
Live tuning via `debug.panel()` in the browser console.

## Star colour calibration

Per-star chromaticity is sampled from a 256-entry blackbody → sRGB
lookup table indexed by B-V. The table is precomputed at build time
(`scripts/colour/blackbody-lut.ts` → `src/client/star-pipeline/blackbody-lut-data.ts`)
and bound to the star shader as a 256×1 `DataTexture`. Each entry
folds three physically-grounded steps:

1. **B-V → effective temperature** via the Ballesteros (2012) empirical
   relation,
   `T_eff = 4600 × (1/(0.92(B-V) + 1.7) + 1/(0.92(B-V) + 0.62))`,
   calibrated against stars with both indices measured independently.
   Accurate across A–K main-sequence, with reasonable extrapolation
   into M and hot B.
2. **Planck × CIE 1931** — the Planck spectrum at T_eff is integrated
   against the CIE 1931 2° standard-observer colour-matching functions,
   using the analytical multi-Gaussian fits in Wyman, Sloan & Shirley
   (2013). The fits reproduce the tabulated CMFs to ~1%, well below
   the chromaticity threshold relevant for star rendering.
3. **XYZ → sRGB D65** — the standard linear sRGB transform (IEC
   61966-2-1), peak-normalised per entry to preserve chroma, then
   gamma-encoded via the sRGB piecewise transfer function. Out-of-gamut
   negative components (hot O-stars whose Planckian chromaticity falls
   outside sRGB) clip to zero before normalisation.

### Per-star intrinsic Teff routing

For each star, the LUT-input intrinsic B-V is sourced via a six-tier
priority chain (`pickTeffSource` in
`src/client/star-pipeline/star-color-routing-pure.ts`). First match wins:

1. **Gaia DR3 Apsis `teff_gspphot`** — primary, ~62% of catalog records.
2. **Gaia DR3 Apsis `teff_gspspec`** — covers some gspphot gaps;
   combined Apsis coverage (gspphot ∪ gspspec) ≈ 84.6% of records.
3. **Ballesteros(B-V)** — Tier 1 fallback when no Apsis solution exists
   but AT-HYG carries a B-V.
4. **Spectral-class T_TABLE** — fallback when neither B-V nor Apsis is
   available but the spectral class is parseable.
5. **White-dwarf Sion Teff** — `50400 / wd_subclass` for parsed WD types.
6. **Solar fallback** — `Ballesteros(0.65)` ≈ 5778 K when nothing
   else resolves.

Where Apsis Teff is used, the LUT-input B-V is recovered via the
analytic Ballesteros inverse so the LUT (which is keyed on B-V) samples
the chromaticity expected for that Teff. Apsis Teff is the **intrinsic**
parameter (Apsis fits include line-of-sight extinction `A0` explicitly),
so the camera-position-dependent dust reddening composes downstream of
this Apsis-derived intrinsic B-V without double-counting extinction.

Dust reddening composes upstream of the LUT: the shader integrates A_V
along the camera-to-star sightline via the Edenhofer 3D dust map and
shifts the LUT-input B-V by `E(B-V) = A_V / 3.1`. The LUT input is
therefore the **observed** (dust-reddened) B-V from the camera's
vantage, not the intrinsic value, so colour drifts physically as the
camera traverses dust between observer and star (the Mu Cephei
"Garnet Star ↔ Peach Star" case study in
`research/star-spectral-rendition/README.md`).

The LUT spans B-V ∈ [-0.4, +2.0] in 256 entries; values are clamped
to the endpoints before sampling. Hotter / cooler tails saturate at
the endpoint colour, which is fine for the catalog's working range
(intrinsic OB stars bottom out around -0.3; the reddest M-supergiants
reach B-V ≈ +2.0–2.5 only after substantial line-of-sight extinction).

Sources:

- Ballesteros, F.J. (2012). New insights into black bodies.
  *Europhysics Letters* 97, 34008.
  https://doi.org/10.1209/0295-5075/97/34008
- Wyman, C., Sloan, P.-P., Shirley, P. (2013). Simple analytic
  approximations to the CIE XYZ color matching functions. *Journal of
  Computer Graphics Techniques* 2(2), 1–11.
  https://doi.org/10.5281/zenodo.10049479
- IEC 61966-2-1:1999. Multimedia systems and equipment — Colour
  measurement and management — Part 2-1: Colour management — Default
  RGB colour space — sRGB.
- Cross-check reference: Mitchell Charity's tabulated blackbody RGBs
  at http://www.vendian.org/mncharity/dir3/blackbody/ (agreement
  ΔE ≤ 5 across 3000–30000 K).

Implementation: `scripts/colour/blackbody-lut.ts` (LUT generator + pure
helpers), `src/client/star-pipeline/blackbody-lut.ts` (generated artifact),
`src/client/star-pipeline/star.vert.glsl` (`ciToColor` sampler), and
`src/client/stellata.ts::makeColorLutTexture`.

## Variable-star modelling

GCVS provides a period and a magnitude amplitude per matched star.
The shader applies a sinusoidal magnitude modulation plus a matching
radius factor to the physical-size term:

- `magMod = 0.5 × ampEff × sin(2π × t / period)` adjusts `appMag`
  (affects point-glow size for distant stars).
- `radiusFactor = 10^(-magMod / 5)` applies to `physSize` (affects
  resolved-disc radius for close stars). This is Stefan–Boltzmann-derived:
  `R ∝ √L` at constant T, which is the defensible single-model assumption
  even though real variables also swing temperature.

GCVS rows without a parseable period, or with zero amplitude, are
skipped at build time — that excludes constant stars, supernovae, and
irregular variables. Typical match rate: ~3.7k of 313k catalog stars.

Implementation: `src/client/star-pipeline/star.vert.glsl` and
`src/client/camera/controls/star-physics.ts` (CPU-side `renderedSizePx`
mirror); see `src/client/star-pipeline/README.md` §Variable star rendering, and
`scripts/catalog/README.md` §GCVS variability cross-match for the
build-time matching rules.

## Solar system

When a host star with planets is focused, Stellata renders the eight
planets, Pluto, faint orbit rings, and the heliopause boundary in the
local frame around the host. Sol is the only populated host so far; the
machinery is generic so future exoplanet-host work can plug in
without changing the renderer.

**Planet positions.** Heliocentric ecliptic positions are computed
from the **JPL Standish 1992 Keplerian-elements approximation**
(https://ssd.jpl.nasa.gov/planets/approx_pos.html), with the cubic
correction terms for Jupiter through Neptune that extend the validity
window to 3000 BC – 3000 AD at sub-arcminute accuracy. Implementation
in `src/client/solar-system/ephemeris.ts` works directly from the
published JPL Table 2a/2b values — no external library, no network
fetch.

The full position chain (Standish ephemeris → ecliptic→ICRS rotation)
is pinned against external sky truth: geocentric RA/Dec for all nine
bodies plus the Sun at three fixed epochs, fetched once from the JPL
Horizons API (ephemeris DE441, retrieved 2026-07-02) and frozen in
`data/horizons/` (provenance + schema in that folder's README). The
regression corpus (`src/client/solar-system/sky-truth.test.ts`) holds
every body within 0.5° of Horizons — the empirical worst case is
Saturn at 0.35°, a known Standish linear-elements residual near the
Jupiter–Saturn great inequality — and the Sun within 0.1°, including
solstice/equinox declination checks that would fail by ~47° on any
mirror-image error in the ecliptic→ICRS rotation.

VSOP87 was the originally-planned ephemeris model and would offer
sub-arcsecond accuracy ±4000 years from J2000. We dropped it during
implementation: planets render as billboarded discs at a pixel-size
floor, and sub-arcminute precision is invisible at every zoom the
user can reach. The Standish approximation is ~50 lines of code over
an 8-row element table, with no dependency cost. Extending validity
beyond ±3000 years from J2000 would need a higher-precision ephemeris
model (VSOP87 or a perturbation-theory series) and is deferred.

**Planet physical data.** Equatorial radii from NASA Planetary Fact
Sheets (https://nssdc.gsfc.nasa.gov/planetary/factsheet/). Semi-major
axes and eccentricities from JPL DE440 mean elements at J2000. Pluto
data from New Horizons 2015 reconnaissance (mean radius 1188 km,
tan-pink colour from MVIC imagery). Representative single-colour RGB
values per planet are observation-derived; pixel-accurate texturing,
banding, and atmospheric haloes are deferred until the renderer
exposes a planet-zoom affordance close enough for them to register.

**Planet geometric albedos** (V-band) from Mallama et al. 2018
(https://doi.org/10.1016/j.icarus.2017.05.018) and the NASA fact
sheets above: Mercury 0.142, Venus 0.689, Earth 0.434, Mars 0.170,
Jupiter 0.538, Saturn 0.499, Uranus 0.488, Neptune 0.442, Pluto 0.49
(HST + New Horizons reconnaissance). Drives the reflected-light
apparent magnitude formula in `src/client/solar-system/`.

**Planet phase functions.** Per-planet empirical V-band phase curves
from Mallama, Krobusek, Pavlov 2018, "Comprehensive wide-band
magnitudes and albedos for the planets, with applications to
exo-planets and Planet Nine" (Icarus 282, 2017, 19–33,
https://doi.org/10.1016/j.icarus.2016.09.023). Mercury,
Venus, Mars and Jupiter each carry a polynomial
`ΔV(α°) = c1·α + c2·α² + …` from the paper's Tables A-1.2, A-2.2,
A-4.2, A-5.2; Earth uses a cubic fit through the four discrete
values published in Table A-3.1; Saturn uses a static-β = 16°
approximation of the joint α/ring-tilt formula in Table A-6.2 (the
ring contribution lands as a constant `c0 = −0.55 mag` brightness
boost). The renderer multiplies the flux factor `10^(−ΔV/2.5)` into
the apparent-magnitude formula in place of the Lambertian default
whenever a planet carries coefficients and α is inside the published
validity bound. Mallama 2018 publishes no phase polynomial for
Uranus, Neptune or Pluto — the first two because their max α from
Earth is "negligible" (the paper models latitude/temporal effects
instead), Pluto because the paper doesn't cover it. Those three —
and every future exoplanet — fall back to the Lambertian phase
function `φ(α) = (sin α + (π − α)·cos α)/π`. See
`src/client/phase-function.ts` for the per-planet coefficients.

**Orbital plane orientation.** Sol's planet system is rendered in its
native ecliptic plane (J2000 obliquity ε = 23.4392911°), so the ring
layout matches what an observer at Sol sees on the sky. For all
*other* host stars (future exoplanets), ring planes default to the
galactic plane — exoplanet-system orientations are generally unknown,
and aligning to the galactic plane gives the user a consistent visual
cue that a focused star has planets without implying a measured
orientation we don't have. The per-host-plane →
ICRS rotation is composed once at attach and reused by the orbit-ring
and planet-body renderers (`src/client/solar-system/orbit-rings-layer.ts`
for the focus-only ring layer;
`src/client/solar-system/planet-body-field.ts` for the global,
focus-independent body field). The rotation is anchored on the north
ecliptic pole in ICRS, `(0, −sin ε, cos ε)` — RA 18h, Dec +66.56°;
the y-component is negative.

**Time `t`.** All planet positions are evaluated at a wall-clock `t`
(Unix seconds, double). `t` is currently pinned to "now" with no scrubber
UI; the bottom-right time readout displays the live UTC timestamp the
positions correspond to. `t` is independent of the cosmetic `uTime`
clock that drives variable-star pulsation — they don't share a value.

Per-`t` cache granularity is 60 seconds: at billboarded-disc pixel
scale, sub-minute planet motion is invisible (Mercury moves ~3e-5 rad
seen from Earth in 60s ≈ 6″, well below pixel resolution at any
zoom). A future time-scrubber UI would plug in by overriding
`Stellata.setT()`.

**Heliopause boundary.** Modelled as an asymmetric ellipsoid centred
on Sol, aligned to the solar apex of motion through the local
interstellar medium. The cited measurements:

- Upwind boundary at **122 AU** — Voyager 1 heliopause crossing,
  2012-08-25.
- Flank inferred at **~115 AU** from Voyager 2 heliopause crossing
  2018-11-05, combined with the apex-aligned ellipsoid model.
- Heliotail at **200 AU** — IBEX / Cassini ENA observations.
- Apex direction: ICRS RA 17h53m, Dec +27.4°, after Frisch &
  Slavin 2013.

The heliopause is **static on human timescales**. Solar-cycle
variations in the upwind distance are at the few-AU level across the
11-year cycle, well below the 122 AU upwind anchor; we don't animate
the boundary.

Construction details (sphere scale, offset, rotation), rendering, and
label anchoring: see `src/client/solar-system/README.md` § Heliopause boundary.

Implementation: `src/client/heliopause.ts` and
`src/client/solar-system/heliopause.{vert,frag}.glsl`.

## Local Group wireframes

The Local Group wireframe layer renders LineLoop outlines for confirmed-
galaxy members out to the canonical 2 Mpc Local Group boundary —
M31 + M33 + the Andromeda subgroup, plus the outer dIrrs (NGC 6822,
IC 10, IC 1613, Leo A, WLM, Sextans A/B, …). Geometry is representational
(stylised LineLoop ellipsoids and discs), but every position, distance,
and structural parameter comes from peer-reviewed catalogues:

**Primary catalogue**: Pace et al. 2024, *Local Volume Database*, Open
Journal of Astrophysics, arXiv:2411.07424 (CC0). A frozen snapshot of
the `dwarf_all` table lives at `data/local-group/lvdb-snapshot.csv` —
909 rows covering the full Local Volume. The build pipeline
(`scripts/local-group/build-local-group.ts`) filters to `confirmed_real = 1`,
`confirmed_galaxy = 1`, and heliocentric distance ≤ 2 Mpc; ~121
objects pass the filter.

LVDB provides position (ra, dec, distance), projected half-light
radius (`rhalf_physical`), ellipticity, and position angle for each
dwarf. The build script projects these into a sky-plane oblate
ellipsoid for the default rendering path:

- `a_pc = rhalf_physical` (semi-major axis in the sky plane)
- `b_pc = a_pc · (1 − ellipticity)` (sky-plane minor axis)
- `c_pc = b_pc` (line-of-sight extent — axially symmetric around the
  projected major axis; line-of-sight 3D extent is generally not
  observationally constrained)
- Orientation: long axis at the catalogued position angle east of
  north; minor axes complete a right-handed basis with the line of
  sight.

**Hand-curated overrides** in `data/local-group/overrides.tsv` replace
structural detail for the singular cases LVDB's summary row can't
capture, and add the two major spirals LVDB's `dwarf_all` table omits:

- **LMC (49.59 kpc)**: inclined disc at i = 32°, line of nodes PA =
  135° (van der Marel & Kallivayalil 2014, *ApJ* 781, 121,
  DOI 10.1088/0004-637X/781/2/121; distance Pietrzyński et al. 2019,
  *Nature* 567, 200, DOI 10.1038/s41586-019-0999-4). Scale length 4.5
  kpc, scale height 1 kpc.
- **SMC (62.81 kpc)**: triaxial 1 : 1.33 : 1.61 with the longest axis
  along line of sight (Subramanian & Subramaniam 2012, *ApJ* 744, 128,
  DOI 10.1088/0004-637X/744/2/128; distance Graczyk et al. 2020,
  *ApJ* 904, 13, DOI 10.3847/1538-4357/abbb2b). Resulting semi-axes
  3.73 / 4.96 / 6.0 kpc.
- **Sagittarius dSph (26.3 kpc)**: 3D axis allocation — LVDB's
  projected ellipticity captures the sky-plane shape but not the
  line-of-sight extent (Ibata et al. 1995, *AJ* 110, 632,
  DOI 10.1086/192237).
- **M 32 (~773 kpc)**: optical-extent ellipsoid 1.6 / 1.2 / 1.2 kpc
  at PA 159°. LVDB's half-light radius of 105 pc renders sub-pixel
  at LG distances; the override uses the broader optical/D₂₅ extent
  cited in McConnachie 2012, *AJ* 144, 4
  (DOI 10.1088/0004-6256/144/1/4).
- **NGC 205 / M 110 (~835 kpc)**: 2.7 / 1.5 / 1.5 kpc at PA 170° from
  the same McConnachie 2012 review — again the optical extent rather
  than the small half-light radius.
- **M31 / Andromeda (776 kpc)**: inclined disc at i = 77°, line of
  nodes PA = 37°, 15 kpc disc radius × 500 pc thickness — the
  structural parameters from the PAndAS survey (McConnachie et al.
  2018, *ApJ* 868, 55, DOI 10.3847/1538-4357/aae8e7). Standalone row
  (not in LVDB's `dwarf_all` table; the override carries RA, Dec,
  distance directly).
- **M33 / Triangulum (840 kpc)**: inclined disc at i = 54°, line of
  nodes PA = 22°, 8.5 kpc disc radius × 400 pc thickness — distance
  from the Cepheid measurement of Bonanos et al. 2006, *ApJ* 652, 313
  (DOI 10.1086/508140). Standalone row.

Per the build's data-freshness policy (`scripts/README.md`
§ Frozen external data), refreshing the LVDB snapshot is an explicit
manual step (curl + `npm run build:local-group --force`) — `npm run
build` never touches the network.

Per the data-fidelity principle above (§ Scope principles), hand-curated overrides are
the exception, reserved for objects with well-studied departures that
no canonical structural row resolves — or, in the case of M31 / M33,
for the major spirals that the LVDB `dwarf_all` table excludes by
construction. Other Local Volume dwarfs render from their LVDB row
directly. As future LVDB snapshots land, the default-path objects
update automatically; only the overrides need re-review against any
structural-paper updates.

Implementation: `src/client/local-group.ts`,
`src/client/local-group/local-group-loader.ts`,
`scripts/local-group/build-local-group.ts`,
`scripts/local-group/build-local-group-pure.ts`. Rendering walkthrough in
`src/client/local-group/README.md`.

## Galactic coordinate system

The shared module `src/client/galactic-coords.ts` exports two constants
used wherever the code needs to anchor in galactic geometry:

- `GAL_TO_ICRS` — a `Matrix4` rotation built from the J2000 IAU
  galactic-pole and galactic-centre angles, with explicit
  re-orthogonalisation to suppress float drift.
- `GALACTIC_CENTRE_PC` — a `Vector3` placing Sgr A* at R₀ = 8.122 kpc
  along the galactic +X axis (then rotated into ICRS by `GAL_TO_ICRS`).

These are reused by:

- The galactic disc-outline reference layer.
- The galactic coordinate sphere (b/l grid).
- The Sol/GC SVG arrow overlay.
- The volumetric Milky Way disc + bulge layer.

Implementation details: see `src/client/galactic/README.md`.

## Milky Way density profiles

The volumetric Milky Way layer raymarches through two proxy meshes —
a disc and a bulge — and accumulates emission along the camera→fragment
ray. The density at each step is:

- **Disc**: `density0 × exp(-(R-R₀)/3000pc) × exp(-|z|/300pc)` — single
  double-exponential thin-disc-like profile in galactocentric cylindrical
  coordinates. The originally-planned Jurić thin/thick/halo decomposition
  was simplified out during iteration; the smooth single component reads
  convincingly enough that the extra components weren't worth the
  calibration cost.
- **Bulge**: `density0 × exp(-r'/1000pc)` where
  `r' = sqrt(R² + (z/q)²)` is the oblate-spheroid radius with q = 0.6.
  Simple exponential rather than McMillan's power-law-times-Gaussian —
  the latter produced too-tight a "ball" that read as point-source-like
  in iteration.

Each component multiplies a population colour pre-integration so the
band's hue varies by line of sight. Defaults are visually calibrated;
see `src/client/milkyway/README.md` for the calibrated values, the magnitude-
consistency conversion that ties Milky Way brightness to the same
magnitude slider as the discrete star catalog, and the full
coordinate-handling chain.

## Interstellar dust extinction

Two distinct dust paths exist in the renderer:

**Per-star extinction.** `star.vert.glsl` raymarches the Edenhofer 2023
voxel grid camera→star and applies:

- `A_V` to `appMag` (dimming).
- `E(B−V) = A_V / 3.1` to `iCi` (reddening of the colour index).

Default strength = 1 (physical realism). Source units are E_ZGR per
parsec; the conversion `A_V / E_ZGR ≈ 2.742` at V band is baked in.

Catalog `absmag` and `ci` are stored **intrinsic** — the build subtracts
the Sol→star integral through this same voxel grid at write time (see
`scripts/catalog/README.md` § Build-time de-extinction), so this
raymarch *restores* the observer-relative extinction instead of adding
it a second time. Because both sides integrate the same model, at
camera=Sol the build subtraction and the runtime addition cancel and a
dusty-sightline star renders at its AT-HYG observed magnitude. This is
what makes the "no double-counting" statements below true across **all**
tiers (previously the magnitude channel was double-counted in every tier
and the colour channel in the ~15% tier-3 stars that read `iCi`
directly). Invariant: any change to this runtime stack ships with the
mirrored build-side integral + catalog rebuild in the same release.

**Volumetric Milky Way dust.** Analytical-only, no voxel sampling.
Profile is `norm × exp(-(R-R₀)/3500pc) × exp(-|z|/125pc)` —
Drimmel & Spergel-style thin-disc dust. Per step, opacity converts to
per-channel optical depth via CCM-derived reddening multipliers
`(0.76, 1.0, 1.35)` — red transmits most, blue extincts away — applied
with Beer-Lambert running attenuation including a half-step
self-shielding term. Default global strength = 0.45.

The Edenhofer voxel grid is **deliberately not used** for the Milky Way
band — voxel structure (~5 pc native) aliases into visible streaks
along long camera→fragment rays (8–15 kpc) regardless of step
distribution. Voxels stay in use for short per-star sightlines.

Implementation: `src/client/star-pipeline/star.vert.glsl` (per-star) and
`src/client/milkyway/milkyway.frag.glsl` (volumetric); see
`src/client/star-pipeline/README.md` §Dust extinction + the shelved particle layer and
`src/client/milkyway/README.md`.

## Multiple-star pipeline

AT-HYG's classic-IDs subset is a single-row-per-system table. Bright
multi-component systems collapse into one row — the brighter primary's
HIP / HD entry — and the visually-distinguishable secondaries
(Sirius B's white dwarf, α Cen B, Procyon B, Algol B/C, every
component of Castor, η Cas, ξ UMa, ζ Cnc, the Trapezium) are absent.
Recovering binary-pair geometry on top of AT-HYG therefore needs an
external pipeline keyed off catalogues that resolve every component
individually.

The architectural consequence of the data-fidelity principle stated in
§ Scope principles is two-fold: **prefer official source-ID
cross-walks over position-based matching whenever the cross-walk
exists**, and **default to the generalised solution, not famous-star
carve-outs + heuristic fallbacks**. Position-based matching fails
systematically on exactly the famous bright close binaries: Gaia's
published 5-parameter PM for Sirius, α Cen, Castor, Algol, Procyon is
corrupted by orbital wobble, so backward-propagating it to J2000 lands
them tens of arcsec off their WDS positions and any position-based
cross-match misses them.

### Architecture

Five layers feed the binary-system pipeline; the boundary between them
is intentional so each can evolve independently as upstream catalogues
update.

**Layer 1 — committed reference data.** Frozen under `data/` per the
freshness policy in `scripts/README.md` § Frozen external data:

- **Washington Double Star Catalog (WDS)** + **Sixth Catalog of Orbits
  of Visual Binary Stars (ORB6)** — Mason et al. 2001, *AJ* 122, 3466
  (WDS); Hartkopf, Mason & Worley 2001, *AJ* 122, 3472 (ORB6).
  Maintained at the U.S. Naval Observatory and Georgia State
  University. Provides ρ/θ separations, position angles, component
  magnitudes, spectral types, HIP/HD cross-IDs (WDS) and full visual
  orbital element fits (P, T, e, a, i, ω, Ω) for ~4k systems (ORB6).
- **Hipparcos van Leeuwen 2007 reduction** — van Leeuwen 2007,
  *A&A* 474, 653, DOI 10.1051/0004-6361:20078357. VizieR I/311/hip2.
  Improved Hipparcos astrometry; the long-baseline PM fallback for
  bright-binary Gaia contamination.
- **CCDM-keyed Hipparcos visual-doubles flag** — Hipparcos main
  catalogue `CCDM` + `MultFlag` columns, as described in
  §Stellar catalog ingestion under § Data sources.
- **Gaia DR3 cross-walks** — `gaiadr3.hipparcos2_best_neighbour`,
  `gaiadr3.tyco2tdsc_merge_best_neighbour`, queried per Gaia
  Collaboration et al. 2023, *A&A* 674, A1,
  DOI 10.1051/0004-6361/202243940. Committed as
  `data/gaia/gaia_dr3_hip_xmatch.tsv` + `gaia_dr3_tyc_xmatch.tsv`.
- **Gaia DR3 5-parameter astrometry** — `gaiadr3.gaia_source`,
  queried for the deduped source_id list the WDS resolution stage
  produces. Per-source RA/Dec/parallax/PM with errors and ref_epoch
  J2016.0; ~99% coverage on resolved WDS components. Committed as
  `data/gaia/gaia_dr3_astrometry.tsv`.
- **Gaia DR3 NSS two-body orbits** — `gaiadr3.nss_two_body_orbit`,
  the non-single-star catalogue, with Thiele-Innes orbital fits
  (Halbwachs et al. 2023, *A&A* 674, A9,
  DOI 10.1051/0004-6361/202243969). Covers the period regime
  P < ~3 yr / sub-arcsec separation where Gaia's astrometric mission
  detects orbits directly. Committed as
  `data/gaia/gaia_dr3_nss_two_body.tsv`.
- **SIMBAD WDS↔Gaia DR3 cross-IDs** — curated by CDS Strasbourg from
  SIMBAD's `ident` and `basic` tables (Wenger et al. 2000,
  *A&AS* 143, 9, DOI 10.1051/aas:2000332). Per-component cross-IDs
  between WDS pair identifiers (`WDS J<id><comp>`) and Gaia DR3
  source_ids. The principled cross-identification path for
  sub-arcsec sub-components ORB6 doesn't enumerate (η Cas A/B/C,
  ξ UMa A/B, ζ Cnc A/B/C, α Cen A/B/Proxima). Committed as
  `data/simbad/simbad_wds_xids.tsv`.
- **SIMBAD per-component spectral types** —
  `data/simbad/simbad_sptype.tsv`. SIMBAD curates per-component
  MK sp_type strings free of variability-type contamination (the
  schema separates sp_type from object-type `otype`), so a
  mixed-class pair like Sirius A0V + DA1.9 surfaces both spectra
  rather than AT-HYG's single inherited "A0V+DA" string.
- **Curated per-component spectral types** —
  `data/binaries/component_sptype_overrides.tsv`. Literature MK
  types for spectroscopic sub-components no machine source
  enumerates (SIMBAD has no object for Algol Aa2): Algol Aa2 K0IV
  (Kolbas et al. 2015, MNRAS 451, 4150), δ Vel Ab A4V (Mérand et
  al. 2011, A&A 532, A50), σ Ori Ab B0.5V (Simón-Díaz et al. 2015,
  ApJ 799, 169), Castor Ab/Bb late-K / early-M (Stelzer & Burwitz
  2003, A&A 402, 719). Top tier of the Stage 6 spectral cascade;
  each entry cites its source in the file.

**Layer 2 — manual-run refresh scripts.** One per dataset, idempotent,
**not** wired into `npm run build`. Per the freshness policy: external
catalogues update on their own clock (Gaia DR3 → DR4 transition window;
WDS rolling daily; HIP2 frozen; SIMBAD rolling continuously), and
freezing the inputs at commit time keeps the build reproducible long-
term. All scripts share `scripts/refresh/refresh_lib.py` (TAP client
+ retry + batching + schema validation); SIMBAD pulls share
`scripts/refresh/simbad/` (specs / inputs / query / TSV plumbing).

**Layer 3 — catalogue builder.** `scripts/binaries/build-binaries.py`
orchestrates seven stages with explicit per-component provenance.
See `scripts/binaries/README.md` for the engineer-level walk-through; the
astronomer-relevant summary:

1. **Load** WDS + ORB6 + AT-HYG + GCVS + CCDM + HIP2 + Gaia
   cross-walks + Gaia astrometry + Gaia NSS + SIMBAD WDS xids +
   SIMBAD per-component spectra into identifier-keyed indices.
2. **Resolve each WDS component to a Gaia DR3 source_id** via a strict
   priority cascade. ORB6's published HIP wins where it has one;
   AT-HYG-native gaia field (HIP-mediated) is next; SIMBAD's curated
   per-component WDS cross-ID is the principled fallback for
   sub-arcsec components; CCDM-sibling HIP position-match handles
   systems CCDM enumerates that the prior tiers missed; AT-HYG
   position-match (PM-propagated to J2000) is the final fall-through.
   ~99% of decomposing WDS pairs resolve at least one component
   through this cascade; the residual unresolved fraction is
   dominated by Aitken-only Tycho doubles with no Gaia coverage at
   all. ρ = 0 sub-resolution pairs (spectroscopic / interferometric
   companions WDS lists without a measured separation) follow the
   blend convention: no instrument separates the photocentre, so a
   secondary that bound nothing of its own inherits the primary's
   identifiers — the same convention WDS itself exhibits when it
   lists Castor's CIA 29 Aa,Ab with one HIP on both sides. Position
   matching is skipped for these pairs: with ρ = 0 the predicted
   secondary position degenerates onto the primary's own coordinate
   and a nearest-neighbour pick can only coin-flip onto a sibling
   component's identity.
   The pipeline also **synthesizes sub-pairs WDS never enumerates**:
   ORB6 carries ~30 orbit fits keyed to component pairs (64 Psc
   Aa,Ab, Castor Ca,Cb = YY Gem via a curated component mapping)
   with no WDS_SUMM row, and Gaia NSS carries ~500 two-body
   solutions belonging to one component of a wider resolved pair.
   Each gets a synthesized pair row so the orbit has a place to
   live; the components inherit the carrier's identifiers per the
   blend convention.
3. **Attach the most-trustworthy astrometric measurement** per
   component. Priority: Gaia DR3 5-parameter where the fit is clean
   (`ruwe ≤ 1.4` AND `ipd_frac_multi_peak ≤ 2%`); Gaia NSS
   centre-of-mass when the 5p is orbit-corrupted AND the source has
   an NSS row; HIP2 long-baseline when the system has any close
   companion (ρ ≤ 5″) AND Gaia-vs-HIP2 PM disagrees by >50 mas/yr on
   either axis (Hipparcos's J1991.25 measurement averages a different
   window of the orbit). Bright Gaia-saturated primaries with no
   Gaia source at all (Sirius, α Cen, Procyon, Algol) take HIP2 by
   construction.
4. **Select orbital elements per system.** ORB6 visual orbits
   (grades 1–5: definitive → indeterminate) win where present —
   ORB6's semi-major axis is the genuine relative A–B orbit. Gaia
   NSS covers the rest of its astrometric-detectability regime
   (period < ~3 yr OR apparent photocentre semi-major axis < 1″) —
   95.8% of DR3 NSS rows pass the period gate, plus the sub-arcsec
   long-period tail through the TI algebra. An NSS orbit describes
   the SOURCE's own two-body motion, so it only attaches to a pair
   whose partner shares the blended source (or carries none):
   when the partner is a different resolved star, the orbit belongs
   to the carrying component's own unseen companion and attaches to
   the synthesized inner pair instead — before this gate, a 4-day
   SB1 period could be stamped onto a centuries-period visual pair.
   The Thiele-Innes → Campbell algebra recovers
   (a0, i, Ω, ω) from NSS's stored (A, B, F, G) quartet via the
   Heintz 1978 / Halbwachs+ 2023 Appendix C closed form, inlined
   rather than imported from ESA's unmaintained NSSTools package —
   but the TI fit tracks the photocentre, so a0 = |q − β|·a_rel
   underestimates the relative separation by the mass-vs-flux
   fraction gap (and its ω is the photocentre's, π away from the
   relative orbit's when the primary carries most of the flux).
   ORB6 non-visual orbits (grade 8 interferometric-visibilities,
   grade 9 astrometric / spectroscopic, and the undocumented grade 7
   the catalog uses for photometric / eclipsing fits — YY Gem,
   EQ Tau, BX And) come last.

   **Estimated scale for spectroscopic orbits.** No NSS solution
   type publishes a relative semi-major axis, and RV / eclipse
   photometry cannot constrain one — so for the non-visual routes
   the pipeline estimates it from Kepler's third law,
   a = M_total^⅓ · P_yr^⅔ AU, with M_total = M₁/(1−q) from the
   primary's spectral-class mass (Cox 2000 §15.2 / Pecaut & Mamajek
   2013, the same tables the q backfill uses; 1 M☉ when the type is
   unparseable). Where no mass ratio is derivable the companion is
   assumed at half the primary's mass (q = ⅓, near the SB1
   mass-ratio distribution's mode). Both estimates enter a ∝ M^⅓,
   so even a factor-2 mass error moves the rendered orbit scale by
   only ~26% — far better than not animating a measured period at
   all, and tagged `a_via=kepler_mass_estimate` in multiples.tsv so
   every estimated axis is auditable. Exactly-circular fits (e = 0)
   that publish no ω — periastron is undefined on a circle — get
   ω = π/2, which places conjunction (the eclipse, for edge-on
   systems) at the fitted T₀, matching the minimum-epoch convention
   eclipser ephemerides use. ORB6 *visual* orbits get none of these
   estimates: their pairs carry real measured placements, and a
   guessed mass ratio would move a rendered pair off its published
   geometry.
5. **Classify each pair as physical or optical** via a 5-tier
   cascade — WDS Notes flag chars confirm or reject directly when
   set; both-components-Gaia parallax (3σ on combined error) and PM
   (≤5 mas/yr per axis) checks are next; the asymmetric-Gaia gate
   handles Sirius A-C/D/E/F shaped cases where only the secondaries
   carry Gaia and the primary's HIP2 parallax is the anchor; the
   orbit-on-file override keeps pairs Stage 4 produced real orbital
   elements for (Sirius A-B, Procyon A-B with their white-dwarf
   companions); the mag-gap heuristic backstops the residual
   Tycho-only systems.
6. **Emit `data/binaries/multiples.tsv`** — two rows per kept
   physical pair (+ standalone rows for SIMBAD-known components the
   pair walk didn't reach), with explicit per-component provenance
   columns recording which tier of each cascade above decided.
   Spectral type is SIMBAD per-component-preferred / AT-HYG
   per-system inherited as fallback; mass ratio `q` rides through
   from Gaia NSS / SB2 spectroscopy where present, with per-class
   mass-table backfill from Cox 2000 §15.2 / Pecaut & Mamajek 2013
   for visual orbits without spectroscopy.
7. **Assert against snapshots.** Per-stage counts gate
   `build-binaries-expected.json`; per-strategy rates gate
   `build-binaries-rates-expected.json`. A regression in either
   surfaces in the build log as a per-key diff and refuses to
   advance. Refreshes are explicit (`UPDATE_BUILD_COUNTS=1`); silent
   drift is impossible.

**Layer 4 — validation harness.** Three tiers covered in
`scripts/binaries/README.md`: a hand-curated Tier A known-stars corpus
(`scripts/catalog/known-stars.tsv`) the binary catalogue must
reproduce; population-statistic Tier B snapshots
(`build-counts-expected.json`); a stratified random 10k SIMBAD sample
Tier C cross-checker (`validate-simbad-sample.ts` + the
`distance-regression-check.ts` build-time subset that surfaces in
`build-distance-outliers-expected.json` with hand-edited reasons).

**Layer 5 — documentation.** This file (astronomer audience —
sources, physics, decisions); `scripts/binaries/README.md` (engineer audience
— functions, thresholds, provenance fields); `scripts/README.md`
(formats — v6 byte plan, name table, search index).

### Worked examples

- **Sirius A-B.** Sirius A is Gaia-saturated (HIP 32349, no DR3
  source_id; ~378 mas via HIP2). Sirius B (the famous DA1.9 white
  dwarf, ~50× fainter at V) resolves to a Gaia DR3 source via
  SIMBAD's WDS xids side-file. The pair has a grade-2 ORB6 visual
  orbit (P = 50.13 yr), so Stage 4 produces real elements; Stage 5's
  optical-pair filter routes through the orbit-on-file tier and keeps
  the pair despite the 9.9-mag photometric gap. Sirius A's HIP2
  astrometry rides through Stage 3's Gaia-saturated branch into
  multiples.tsv; Sirius B's Gaia 5p astrometry rides through the
  default tier. Both components emit per their own spectral type
  (SIMBAD: A0V + DA1.9), not the inherited AT-HYG "A0m+DA" string.
- **α Cen A-B + Proxima.** Both A and B are Gaia-saturated; both
  carry HIPs (71683, 71681) but no DR3 source_id. SIMBAD's WDS xids
  bind the HIPs per-component; Stage 3 routes both through HIP2
  long-baseline (5″ companion gate engages on the AB pair). Proxima
  (HIP 70890) is the wider WDS member and resolves to its Gaia
  source via AT-HYG-native; its Gaia 5p astrometry rides through.
  Phase 5 will eventually derive the AB orbital geometry from the
  ORB6 grade-1 visual orbit (P = 79.91 yr, the canonical reference
  fit).
- **Algol.** β Per A-B-C is the classic eclipsing binary at
  ~28 pc. The inner AB pair has a Gaia DR3 NSS Eclipsing solution
  recovered from RVS spectra; Stage 4 routes through `gaia_nss` and
  reads inclination + arg_periastron directly from the NSS columns
  (eclipsing types don't constrain `a` from photometry alone). The
  wider AC pair takes the ORB6 visual orbit. Stage 5 keeps both
  pairs through the orbit-on-file override despite the magnitude gap
  to the C component.
- **Castor — the sextuple showcase.** WDS enumerates the AB visual
  pair (grade-3 ORB6, P = 459 yr) and both spectroscopic sub-pairs
  Aa,Ab (P = 9.21 d) and Ba,Bb (P = 2.93 d) as CIA 29 rows with
  published interferometric semi-major axes. The third pair —
  Castor C = YY Gem, the eclipsing M-dwarf twin pair at
  P = 0.814 d — exists in ORB6 only under its variable-star name
  with a blank components field, so a curated mapping
  (`data/binaries/orb6_component_overrides.tsv`) keys it to Ca,Cb
  and the pipeline synthesizes the pair row WDS lacks. ORB6's
  eclipse fit gives P and i = 86.5° but no semi-major axis; the
  Kepler estimate from two M0.5Ve table masses (Torres & Ribas
  2002: 0.599 + 0.601 M☉) lands at 0.0171 AU vs the published
  0.0182 AU. All six components render, three inner pairs animate,
  and YY Gem's eclipses come from real orbital geometry.
- **HIP 25733 — a Bailer-Jones refinement case.** AT-HYG's `dist_src`
  marks this row's catalogued 14.3 kpc as a Gaia DR3 inverse-parallax
  estimate (`G_R3`) with low S/N; Bailer-Jones's photogeometric
  posterior pulls it back to ~5–7 kpc. This is the dominant failure
  mode the B-J Layer 1 override is designed to rescue and is one of
  the cases the Vaidman 2025 validation harness pins.
- **An LMC supergiant — e.g. HDE 268743 / R 90, S Dor analogue.**
  AT-HYG's `dist_src = G_R3` plus a low-S/N Gaia parallax routes it
  through B-J first, which lands somewhere intermediate (5–20 kpc;
  B-J's smooth Galactic-density prior has no LMC). The LMC kinematic
  override fires on the second pass — sky-cone match + PM within
  ±0.5 mas/yr of (μ_α* = 1.85, μ_δ = 0.20) — and snaps `dist` to
  Pietrzyński 2019's 49.594 kpc. The bounded-scope cutoff then keeps
  it (49.594 kpc < 50 kpc); without the LMC layer it would either
  have been dropped or rendered as a Galactic foreground star at a
  catastrophic intermediate distance.

### Catalog-side binary detection

The Phase 3 build (`scripts/catalog/build-catalog.ts`) does its own
binary flagging at the single-star catalogue level — independent of
the WDS/ORB6 pipeline above and serving a different purpose. Both
sources OR onto the same `flags` bit so the chart-mode wings glyph
surfaces either, but neither pretends to recover orbital geometry.

**Geometric pass.** Spatial nearest-neighbour pass at separation
`BINARY_MAX_SEP_PC = 0.005 pc` (≈1030 AU). Rationale: at the
renderer's `minDistance = 0.005 pc` orbit, anything farther than that
subtends >45° from the camera — it wouldn't fit the viewport as a
visual "system". Yields only ~14 pairs from the classic_ids subset —
the brighter primary of most visual doubles has a classical ID, but
the secondary often doesn't, so the geometric pass can only see the
α Cen-style cases where both components survive the cut. Each side
stores the other's row index in `companionIdx`.

**CCDM + MultFlag HIP-keyed cross-match.** Hipparcos's `CCDM`
column links each HIP to the Catalog of the Components of Double
and Multiple stars (Dommanget & Nys 1994). CCDM alone is too
permissive — it tags wide line-of-sight optical pairs Hipparcos
didn't confirm — so the build script gates it with `MultFlag`,
keeping only `C` (component), `G` (resolved-in-field), and `O`
(orbit known) entries. A small curated `KNOWN_VISUAL_DOUBLES` set
in `scripts/catalog/visual-doubles.ts` recovers canonical visual
doubles Hipparcos modelled as single stars (Polaris, ε¹ Lyr,
61 Cyg A/B). Together with the CCDM pass this surfaces Sirius,
Mizar, Castor, α Cen, Albireo, γ And, ε Lyr, 70 Oph, Procyon,
Algol, etc. that the geometric pass misses. No `companionIdx` is
assigned — the secondary is usually not in the classic_ids subset,
and the renderer's zoom-fit code already guards on
`companion ≥ 0`.

The full WDS+ORB6 pipeline above (multiples.tsv) is the source of
truth for per-system orbital geometry. The catalog-side passes
consume it in two complementary ways:

1. **Companion promotion.** `scripts/catalog/companion-promotion.ts`
   reads multiples.tsv and promotes the secondary of every physical
   pair whose identifier isn't already in AT-HYG into a first-class
   catalog.bin record. Position comes from the row's own Gaia 5p
   astrometry when available, otherwise from a sky-plane tangent
   projection of the primary's xyz using the published WDS sep + PA;
   absmag is imputed from the primary's AT-HYG absmag plus the WDS
   Δmag when the row inherits its parent's photometry. Promoted
   companions ride catalog.bin with `FLAG_BINARY_COMPANION_ONLY`
   set; the renderer / picker / hover / focus stack picks them up
   with zero code change.

2. **Runtime artifact.** `scripts/binaries/build-runtime-binaries.py`
   emits `public/binaries.bin` — one record per kept physical pair,
   carrying Kepler elements (when known) plus the sep+PA the
   `BinaryOrbitField` uses for per-frame orbital evaluation.
   `public/catalog-row-index-map.json` joins the runtime binary's
   primary/secondary indices back to catalog.bin record indices.

Implementation: `scripts/binaries/build-binaries.py` for the WDS+ORB6
pipeline (engineer walk-through in `scripts/binaries/README.md`);
`scripts/binaries/build-runtime-binaries.py` for the runtime artifact;
`scripts/catalog/build-catalog.ts` + `visual-doubles.ts` +
`companion-promotion.ts` for the catalog-side passes (see
`scripts/README.md` § Geometric binary inference and § TDSC double-
star cross-match for per-pass detail).

## Constellation stick figures

Classical asterism lines come from Stellarium's modern sky culture
(MIT-licensed, HIP-indexed). Each Stellarium polyline references stars
by HIP number, which is resolved against AT-HYG's `hip` column at build
time. Any unresolved HIP is a hard build error unless explicitly listed
(with rationale) in `KNOWN_MISSING_HIPS` — currently α Phe (HIP 5165)
and μ Sgr (HIP 89341), both stars Stellarium references that have empty
position columns in the AT-HYG CSV.

Implementation: `scripts/catalog/build-catalog.ts`; see
`scripts/README.md` §Stick figures from Stellarium for the
pipeline + missing-HIP policy.

## Modelling decisions deliberately not made

These are the science-flavoured items from the project-wide scope list
in `CLAUDE.md`. Restated here so the rationale lives alongside the
science it relates to.

- **IAU constellation boundary datasets.** Only the asterism lines are
  included — boundaries would be a separate Stellarium dataset and
  carry no visual benefit at the camera scales the app operates in.
- **Time-series proper motion — decision reversed, design accepted.**
  Positions are still a static snapshot today (now J2016.0, ~10 years
  stale; the highest-PM neighbours are visibly off by ~1–2 arcmin), but
  runtime propagation to `t` is now designed — see § Current-epoch
  star positions above; implementation is tracked work. Per-layer
  epoch table and the staleness audit live in `data/README.md`
  § Reference epoch and proper motion.
- **Spiral-arm overdensities** in the Milky Way volumetric background.
  The Reid et al. masers offer a maser-anchored spiral model that could
  ride atop the smooth disc profile, but the smooth band reads
  convincingly enough that re-introducing higher spatial frequency
  (and the aliasing risk it carries through 32-step raymarching) isn't
  worth the complexity.
- **Irregular / supernova variables.** GCVS entries without a period are
  skipped — can't animate without one.
- **Temperature-swing component of variable-star brightness change.**
  We use `R ∝ √L` (constant-T assumption); real pulsating variables
  split the brightness change between R and T swings. Modelling T
  changes per variable type is more complexity than the visualisation
  warrants.
- **Moons.** Earth's Moon, the Galilean satellites, Titan, Triton, etc.
  The Standish ephemerides cover only the eight major planets +
  Earth-Moon barycentre stand-in for Earth. Adding satellite
  ephemerides is a separate effort and out of scope at the camera
  framings the app currently affords.
- **Asteroids and minor planets.** Ceres, Vesta, the Trojans, NEOs.
  Same reason as moons — separate ephemeris source and not visible
  as discs at any camera distance the app currently exposes.
- **Time-evolving heliopause shape.** Solar-cycle variation in the
  upwind boundary is real (~few AU peak-to-peak) but well below the
  layer's coarse 122-AU anchor; we treat the shell as static.
- **Planet textures, banding, atmospheric haloes, ring systems,
  axial-tilt cues, day-night phase shading.** All deferred until the
  renderer can fly the camera close enough to a single planet for the
  detail to register. At the user-reachable camera distances today
  every planet floors at the disc-pixel minimum, so detail rendering
  would be invisible. See § Scope principles — Defer detail until
  zoom affordance above.
