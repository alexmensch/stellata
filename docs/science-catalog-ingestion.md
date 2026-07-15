# Stellar catalog ingestion

Split out of `SCIENCE.md` § Stellar catalog ingestion. Covers the
AT-HYG/Gaia/Hipparcos merge, the Bailer-Jones and LMC-kinematic
distance overrides, driver-astrometry precision, and current-epoch
space-motion propagation. Spans `scripts/catalog/`, `data/athyg/`,
`data/gaia/`, `data/bailer-jones/`. See `SCIENCE.md` for scope
principles and data-source policy that apply across the whole catalog.

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

There is no source-aware filtering. The 100-byte v9 binary record
preserves none of the `*_src` columns either, so the renderer can't
distinguish a Tycho-positioned, Gaia-distanced row from a "pure"
Hipparcos one — every star is shaded by the same physical model
(`docs/science-stellar-modelling.md` §Stellar physics, §Stellar
perception model). The record does carry each
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

**The override is at its DR3 ceiling — don't re-probe.** A 2026-05
audit walked every identifier chain for the residual: of the AT-HYG
rows with a source_id but no B-J posterior (~1.6k), the HIP-consistent
subset are genuine DR3 sources that Bailer-Jones simply didn't publish
(2-parameter position-only solutions, or excluded by their quality
filter), and none of the alternative source_ids recoverable through
the HIP or Tycho-2 cross-walks appear in B-J either. The empty-`gaia`
AT-HYG rows recover ~190 source_ids via the HIP cross-walk (now wired
into `resolveGaiaSourceId` — the `gaiaSourceIdBackfilled` build count)
— worth having for cross-match keying, but zero of those unlock a B-J
posterior. Coverage next improves with Gaia DR4 and a B-J-successor
republication, not with more cross-walk work.

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
cone of the LMC's PM dynamical centre (RA 78.76°, Dec −69.19°; van
der Marel & Kallivayalil 2014, *ApJ* 781, 121,
DOI 10.1088/0004-637X/781/2/121) whose proper motion lies within
±0.5 mas/yr of the gate centre (+1.85 mas/yr in RA, +0.20 mas/yr in
Dec — a rounded working value near the same paper's centre-of-mass
PM of μ_α* = 1.910 ± 0.020, μ_δ = 0.229 ± 0.047 mas/yr, well inside
the tolerance) has its `dist` snapped to the LMC's eclipsing-binary distance
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
writes them per record into the binary at offsets 52–79 (see
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
  temperature when available — see `docs/science-stellar-modelling.md`
  §Star colour calibration §Per-star intrinsic Teff routing for the
  six-tier resolver and why Apsis
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

## Driver astrometry — AT-HYG precision findings and the direct-sourcing decision

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

## Current-epoch star positions — space-motion propagation to `t`

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

- `catalog.bin` v8 appended per-record `vx/vy/vz` `float32` pc/yr
  (bytes 84–95, stride 84 → 96 after the v7 `sid`; +3.9 MB ≈ +15%).
  Positions stay
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
  escalation and reads the same velocity columns, but is not needed for
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
linearly), else whichever member has one. Because
`BinaryOrbitField` places a Tier-1/2 secondary at
`primary + baseDiffPc + ΔR(t)` from the Kepler *elements alone*
(never `abs[s] − abs[p]`; `src/client/binaries/README.md` § Tier
mapping), the rendered relative offset — its baseline caches and
eclipse photometry's `baseDiff` — is invariant under the advance
*regardless* of the members' baked velocities; orbital motion stays
owned by the Kepler layer with no double-counting and no field-code
change. The velocity coherence therefore matters only for **Tier-3
static** companions (which the field skips): a promoted companion
with no own PM must ride its primary or it freezes at `v=0` and
shears. v1 delivers that (mint-time inheritance in
`companion-promotion.ts`) plus the blend for renderable-orbit pairs
the *catalog build* resolves. **Full** systemic coherence for
`binaries.bin`'s authoritative pairing — which re-homes some inner
pairs and owns the Tier-3 static pairs the catalog build doesn't
group — is deferred to `stellata-zau1` (the pairing is only known in
the binaries pipeline; residual shear is sub-arcsec/decade over the
v1 load-time advance). (This resolves the anchor-seam question
tracked as `stellata-nmu.4`: v1 is the CPU-baseline scheme at load
granularity; the GPU-attribute scheme remains the documented
escalation.)

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

