# Per-row pipeline and reference-catalogue parsing

The spine row walk (`readStars` in `stars-parse.ts`) and everything it
resolves per star: space-motion velocity, the GCVS variability cross-match,
and Stellarium stick figures. Spectral class and physical radius are resolved
here but owned by `../spectral/`. The binary record layout these fields land
in is `../README.md` § Binary catalog format; the membership term it walks is
`../spine/README.md`.

## Files in this area

```
scripts/catalog/parse/
  stars-parse.ts (+ test)         readStars — the per-row pipeline. The hub
                                  every other subfolder imports.
  read-stars-inputs.ts            The spine path, plus source paths + loaders
                                  for every reference table readStars
                                  consumes, and the mtime set derived
                                  artifacts invalidate against. One loader is
                                  a derived index rather than a file read: the
                                  bound-sibling parallaxes the distance
                                  cascade's bottom tier lends, which cross
                                  multiples.tsv with the Gaia table already
                                  loaded here.
  gaia-xmatch.ts (+ test)         Gaia DR3 best-neighbour cross-walk parsing
                                  (HIP + TYC, one shared accumulator) plus the
                                  Apsis and 5p astrometry side-tables. The HIP
                                  walk now serves the GCVS byGaia bridge in
                                  build-catalog.ts, not the record walk. The
                                  TYC reader streams and takes a keep-set —
                                  its table is 2.5 M rows. Cross-language
                                  parity with scripts/binaries/parsers.py is
                                  pinned in ../validate/.
  gcvs/                           GCVS variable-star parsing and the
                                  variability cross-match, with its own
                                  README. Read by build-catalog only.
  constellations.ts (+ test)      The IAU-88 table (CONSTELLATIONS /
                                  CON_INDEX), the Stellarium source path, the
                                  two things read out of that file — stick
                                  figures → constellation line segments +
                                  public/constellations.json, and
                                  readIauEdgeRecords → the B1875 IAU boundary
                                  segments — plus
                                  createConstellationAssignment, which binds
                                  the boundary lookup to the table's indices
                                  (§ Positional constellation membership).
  corpus-tsv.ts                   Shared TSV header, cell and record-ref
                                  parsing. RECORD_REF_KINDS is the one list of
                                  ways a corpus row addresses a record —
                                  hip / gaia / name / hd. headerIndex
                                  is the one header walk for every committed
                                  table (see § TSV header resolution) and
                                  dataRows is the row iterator over it; the
                                  cell + record-ref helpers additionally serve
                                  the frozen regression corpora
                                  (known-stars.tsv, multi-star-regression.tsv,
                                  system-pair-topology.tsv).
  star-fixture.ts                 Test-only star-record builder.
  spectral-encoding-parity.test.ts
                                  Pins the spectral encode/decode round-trip
                                  against the runtime decoder.
```

## TSV header resolution

`headerIndex(headerLine, cols, fileLabel, refreshHint)` in `corpus-tsv.ts` is
the single header walk for every committed table the build reads:
`parseGaiaAstrometryCatalogTsv` / `parseHip2Tsv` / `parseNssSourceIdSet`
(`../distance/direction-cascade.ts`), `parseBailerJonesTsv` and
`parseSimbadWdsXidsTsv` (`../catalog-pure.ts`), `parseSimbadSampleRows`
(`../validate/simbad-sample-parse.ts`), and the classic-ID parsers
(`../classic-ids/classic-ids-parse.ts`).

**It throws on a missing column AND on an empty or headerless file.** Every
input is a committed, usually LFS-tracked artifact, so zero rows means
truncated or unsmudged, never an empty dataset — a parser answering with an
empty map turns a missing file into a silently zeroed join that only surfaces
as a count drift much later. A valid header with no data rows is a different
thing and legitimately yields no rows.

Three deliberate exceptions:

- `gaia-xmatch.ts` streams a 2.5 M-row table line-by-line and dedups on
  angular distance, so it needs its own accumulator.
- `iterSpineTsv` (`../spine/inherited-spine-pure.ts`) demands the header be
  the column list **byte for byte, in order**, where `headerIndex` resolves
  columns by name in any order. That is the stricter contract on purpose: the
  spine is frozen and its codec writes the header, so a header that merely
  parses is already a file nobody meant to ship.
- `parseSimbadSptypeTsv` (`../spectral/spectral-resolve.ts`) demands only
  `source_id` and `sp_type`, treating `hip` / `tyc` / `gj` / `sp_qual` /
  `otype` as optional. Four of those five ARE the ladder's designation tiers,
  so a column vanishing from a re-pull zeroes a tier rather than throwing —
  the failure mode this section otherwise exists to prevent. What catches it
  instead is downstream: `spectralSimbadByTyc` / `ByGj` are pinned in
  `../build-catalog-expected.json`, so a zeroed tier fails the build's count
  assert. Tightening the parser onto `headerIndex` would move that catch
  upstream to the read.

## Per-row pipeline

Each spine row walks through, inside `readStars`. The row arrives with its
`gaia_source_id` already resolved — the native-cell → HIP-cross-walk
precedence and both binding gates ran when the spine was frozen, and
re-running them here would re-decide a binding against reference tables that
have since moved (`../spine/README.md` § The identifier columns are read,
never re-derived).

0. **Parallax resolution** (`resolveParallax` in
   `../distance/parallax/`), and `dist = 1000/plx`. Every tier is a
   catalogue this build pulled itself; the spine's printed `dist` cell
   is no longer one. A row no tier reaches is parked as a § 6.1 ledger
   drop and builds no record — the one place the walk stops producing a
   record deliberately rather than through a pinned-at-zero gate.
1. **Bailer-Jones (DR3) distance override** (`applyBailerJonesOverride`
   in `catalog-pure.ts`), eligible where the tier above resolved
   `gaia_dr3_inversion` — the posterior treats that measurement, so a
   non-Gaia parallax must not be regressed onto its Galactic-density
   prior. See `../distance/README.md` § Multi-layer distance refinement.
2. **LMC kinematic override** (`applyLmcKinematicOverride`). See
   `../distance/README.md` § Multi-layer distance refinement.
3. **`MAX_DIST_PC = 50_000` bounded-scope cutoff**
   (`stars-parse.ts`). Drops rows still beyond LMC depth.
4. **Direction resolution** (`resolveDirection` in
   `direction-cascade.ts`) selects the tier's solution; `directionOnPm`
   advances it to the scene epoch once the motion the row carries is
   settled (§ Space-motion velocity), and `xyz = direction × distance`
   in float64. See
   `../distance/README.md` § Direction resolution. Every solution
   propagates rather than shipping its source's own epoch, so a row no
   tier reaches resolves to null and the walk drops it —
   `spineDroppedNoDirection`, pinned at 0.
5. **Spectral classification** (`resolveSpectralInfo`; Sol special-cased
   to curated G2V in `stars-parse.ts` — no HIP/Gaia/SIMBAD key reaches
   it). See `../spectral/README.md`.
6. **Constellation** — positional, from the resolved xyz
   (§ Positional constellation membership). Nothing here sets the
   DESIGNATION's constellation: the spine carries no editorial `con` cell.
7. **Johnson V and absmag** (`resolveVMagnitude`, then
   `apparentToAbsoluteMagnitude` on the distance the whole override stack
   settled). See `../photometry/README.md` § The V cascade. The spine's
   printed `mag` cell is no longer read by anything. The tier that
   won is kept on the record as `vVia`, because it decides whether the
   magnitude is the system's blend or one component's — companion
   promotion's flux conservation may only subtract a companion's light
   from a blend (`../companions/README.md` § Anchor flux conservation).
8. **B−V** (`resolveColourIndex`) — the Gaia relation, else printed
   `I/239` B−V, else Gaia's synthetic B−V, else the intrinsic
   spectral-class colour, else solar. See
   `../photometry/README.md` § The ci cascade. Its `isObserved` verdict is
   what decides whether de-extinction de-reddens the value, so the two
   measured tiers and the two derived ones part company here rather than at
   the dust integral.
9. **Physical radius** (`physicalRadius`). Stefan-Boltzmann from absmag
   and the resolved Teff — the measured Apsis Teff (gspphot → gspspec
   via `resolveApsisTeff`, 2–60 kK sanity window) when present, else
   the class-table value; BC always class-table. White dwarfs
   special-cased to 0.013 R☉; Wolf-Rayets keep their own ramps (Apsis
   models neither). Clamped to [0.08, 2500] R☉.

`athygDist` / `athygDistSrc` are build-time-only, like `vVia`: the spine's
printed `dist` / `dist_src` cells, kept pre-override so the post-build
distance-regression check has the input to measure drift against.

The spine carries no `x0/y0/z0`, and AT-HYG's was never consumed: it is a mixed-epoch
merge artifact, tabulated at ~3 dp (a 206 AU grid) and internally
inconsistent with the same row's printed ra/dec by up to tens of
arcsec on high-PM stars (`docs/science-catalog-ingestion.md` § Driver astrometry).

## Space-motion velocity

Each record carries a space-motion velocity (`vx/vy/vz`, pc/yr, equatorial
Cartesian) alongside its J2016.0 position. Positions stay at the fixed
scene epoch on disk; the runtime epoch-advance pass
(`src/client/loaders/epoch-advance-pure.ts`) reads these once at load to
propagate every position to `getT()`. Full design:
`docs/science-catalog-ingestion.md` § Current-epoch star positions.

`velocityPcPerYr` (`direction-cascade.ts`) assembles
`v = v_r·û + d·MAS_TO_RAD·(μ_α*·ê + μ_δ·n̂)` from the tier solution
`resolveDirection` selected (`DirectionSolution.src*` fields), so position
and velocity come from one astrometric solution wherever that solution states
both. Where it states only a position, the PM comes from a designation-keyed
tier instead — and carries that position to the scene epoch as well as the
velocity, so the two still read one motion. The pairing rests on both
quantities describing the same object:
`../distance/pm-rescue/README.md` § Why an owned PM on a blended row
is admissible at all. The
east/north tangent basis is `equatorialTangentBasis`
(`src/client/util/equatorial-basis.ts`), shared with `directionAtEpoch`,
`companion-promotion.ts`'s sep+PA projection, and the runtime's Tier-1
sky→ICRS orbit projection. μ_α* is cos δ-applied — never divide by cos δ.

Velocity source per row (pinned in build-counts as `velocity*`):

| PM source | Rows routed |
| --- | --- |
| Gaia DR3 5p PM | gaia_5p / gaia_nss_systemic tiers |
| HIP2 PM | hip2_saturated / hip2_pm_discrepant tiers |
| Tycho-2 PM | tycho2 tier, plus the rescue cascade's 242 |
| CNS5 PM | cns5 tier, plus 2 |
| SIMBAD bibcoded PM | simbad tier, plus 17 |

**A tier with no PM of its own does not end the search.** The 276 rows whose
direction tier carries none — Gaia 2p solutions, Tycho-2 rows with no mean
solution — re-key on the record's own designations through
`../distance/pm-rescue/`. `velocityZero` is what survives that: Sol, 8 clamped
artifact rows, and the 15 the rescue leaves. The rescued motion then advances
the tier's position too (`directionOnPm`), so the 3 Tycho-2 rows stating an
observed J1991.25 position stop tracking their rate from a 24.75-yr-stale place;
the 273 Gaia rows are already at J2016.0 and do not move.

The spine's printed `pm_ra`/`pm_dec` is **no longer a velocity source**, and
routing these rows to it is exactly what the rescue cascade exists to avoid.
Its one remaining consumer is the LMC override's bulk-PM gate.

`velocityAboveEscape` moved when the rv cascade took its SIMBAD tier — a
published-but-wrong velocity is what these thresholds are for, and which rows
moved is recorded in `../distance/radial-velocity/README.md` § The sanity
thresholds.

Radial velocity comes from its own cascade — Gaia DR3 `radial_velocity` on a
row with a 5p solution, else a bibcoded SIMBAD `rvz_radvel`
(`../distance/radial-velocity/README.md`) — and is zero where neither tier
carries one. The 5p condition is the same one the PM rescue turns on: a 2p
row's RVS spectrum is as blended as its astrometry, and both cascades read it
off `../distance/gaia-distrust.ts`. **Sol** carries
no PM row and sits at the origin, so its velocity is forced to exactly zero
(the advance pass must leave the world origin fixed).

**Sanity ceiling + escape-velocity ratchet.** `v = d·μ` inflates a noisy
sub-arcsec/yr PM on a faint distant star into thousands of km/s, and a bad
`rv` cell shows up as a nonphysical radial term. Three tracked thresholds
guard this:

- A radial term that alone exceeds `VELOCITY_SANITY_CEILING_KM_S` is dropped
  **before** assembly (`radialTermExceedsCeiling`), leaving the row's measured
  PM intact — the clamp below would otherwise take a real proper motion down
  with a bad velocity. Counted `rvRadialRejected` and logged per star;
  `../distance/radial-velocity/README.md` § The sanity thresholds carries the
  case that fixed the rule.
- `VELOCITY_SANITY_CEILING_KM_S` (1500, ~3× escape): a hard clamp — the
  velocity is zeroed (kept at J2016.0, same as no-PM rows) so the star
  doesn't streak under the advance. Counted `velocityClamped` (a subset of
  `velocityZero`); each clamped star is logged at build time.
- `GALACTIC_ESCAPE_VELOCITY_KM_S` (550): a **ratchet, not a clamp**. Unbound
  stars are genuinely exceptional (a handful of proven hypervelocity stars
  Galaxy-wide), so a large above-escape population is almost all artifact —
  but these rows are KEPT (a proven escaper must survive) and counted
  `velocityAboveEscape`, pinned in build-counts so the artifact tail stays
  visible. A drift forces review; a proven genuine escaper gets whitelisted
  rather than silently dropped. Finer per-row PM-S/N + RV-sanity filtering
  is future work (`stellata`-tracked).

**Pair coherence.** A bound pair's components share one systemic velocity;
otherwise the epoch-advance shears a *static* (Tier-3) pair apart. The
load-bearing guarantee here: a promoted companion inherits its anchor
primary's velocity at mint time (`companion-promotion.ts`), so the ~9k
synthetic/inherited-id companions with no own PM ride the primary instead of
freezing at `v=0`. A systemic-velocity post-pass additionally blends the
renderable-orbit pairs the build resolves (lone pair →
`v_sys = (1−q)·v_p + q·v_s`; hierarchy → root-anchor velocity). Tier-1/2
offsets are elements-owned (`BinaryOrbitField` repositions the secondary
from the primary each frame), so their baked velocities never affect the
render. **Full** systemic coherence for `binaries.bin`'s authoritative
pairing — which re-homes some inner pairs and owns the Tier-3 static pairs
this build doesn't group — is `stellata-zau1` (deferred; the pairing is only
known in the binaries pipeline, and the residual shear is sub-arcsec/decade
over the v1 load-time advance).

After the per-row pass: GCVS cross-match (`bridgeGcvsByGaia`), CCDM
visual-doubles flagging (`visual-doubles.ts`), and the 100-byte v9
record write per star including the seven `float32` Apsis fields, the
`uint32` `sid`, the three `float32` velocity components, plus the
`uint8` multiplicity status. See sections
below.

## Positional constellation membership

Catalog byte 34 is **positional**: `createConstellationAssignment`
(`constellations.ts`) resolves the IAU (Delporte 1930) boundary region a
record's own xyz falls in and maps it onto the `CONSTELLATIONS` index
space. The geometry — the B1875 precession, the edge decomposition, and
its self-validating 89-region invariant — is
`src/client/constellation-boundaries/iau-geometry/README.md`; this module owns only
the index mapping, and throws at construction if a region names a
constellation the IAU-88 table doesn't carry.

Two properties follow from the boundaries partitioning the whole sphere:

- **`NO_CONSTELLATION_INDEX` is unreachable for anything with a
  direction.** Sol sits at the origin and has none, so it is the sole
  holder — asserted at the record write in `../build-catalog.ts`. Every
  other record, including the promoted companions that used to inherit
  the anchor's index (and the ~5.0k whose anchor had none to give),
  carries a real constellation.
- **A row needs no catalogue entry to be classified.** The uncatalogued
  Gaia fill tier resolves on position like everything else.

**The designation's constellation comes from IV/27A, not from this walk.** A
star's *designation* constellation is fixed by nomenclature and diverges from
position once a boundary moves past a named star: ρ Aql / 67 Aql (HIP 99742) has
been positionally in **Delphinus** since 1992 and is ρ **Aquilae** permanently.
AT-HYG's editorial `con` cell used to seed it; the spine carries no such column,
so the walk leaves `desigConIndex` (search-index `dc`) at
`NO_CONSTELLATION_INDEX` and the classic-ID label pass fills it from IV/27A
keyed on the record's own HD/HIP — cascade, coverage and the GCVS precedence in
`../classic-ids/README.md` § The designation constellation.
`designationConIndex(dc, c)` in `../catalog-pure.ts` is still the single
statement of which field a Bayer / Flamsteed / GCVS designation reads, and the
positional `conIndex` is still the last fallback (123 faint Flamsteed-only
records IV/27A's TAP subset omits).

The population that fallback would silence is not small: 65 search entries carry
a `dc` today, dominated by Flamsteed numbers assigned under Ptolemaic
constellations that the 1930 Delporte boundaries reassigned (15 LMi sits in Ursa
Major, 41 Lyn — Intercrus — likewise), plus the boundary-straddling promoted
companions whose composed names take the anchor's designation (Fomalhaut C is
α PsA C while sitting in Aquarius).

**A GCVS designation names its own constellation.** "LT Vul" names Vulpecula
whatever any catalogue column says, so `applyVariability` (`gcvs-parse.ts`)
sets `desigConIndex` from the designation's trailing abbreviation wherever
IV/27A left it empty — `gcvsDesignationCon` pins **7,363**. Its authority is
not a fallback position: the cell it used to correct was untrustworthy both
ways —

- **Stale** — LT Vul was filed under Sagitta, but sits in Vulpecula *and*
  is named for it, so designation and boundaries agreed against the cell.
- **Right on position, wrong on the name** — RY Cen (cell and position
  both Lupus, named for Centaurus) and EQ Vul (both Lyra, named for
  Vulpecula) are genuine ρ Aql-shaped movers, and were **invisible** to any
  check reading the designation constellation off the cell.

Those two plus CM Ind (named for Indus, positionally in Pavo) are the GCVS
share of the **65** entries `designationConMismatch` pins; the rest come from
IV/27A.

## Stick figures from Stellarium

Classical asterism lines are sourced from Stellarium's modern sky culture
`index.json` (CC/MIT-compatible, HIP-indexed). The source file is
committed to `data/stellarium/stellarium-modern-skyculture.json` — it essentially
never changes, so fetching it at build time each time would be wasted
work.

Pipeline in `scripts/catalog/build-catalog.ts`:

1. The HYG CSV parser reads the `hip` column into each star record.
2. After sorting stars by absmag (so record indices are final), a
   `hipToIndex: Map<number, number>` is built from the post-sort order.
   Duplicate HIPs (rare — binary companions) keep the brightest entry
   (first-write wins).
3. `buildFigureLines(hipToIndex)` walks each Stellarium constellation's
   `lines` array and resolves every HIP to a record index, producing
   `Map<conIndex, number[][]>`.
4. Resolved `lines` are merged into the emitted `constellations.json`
   alongside `{ code, name }`. A polyline is kept only if ≥2 points
   survive.

**Reliability rule: any unresolved HIP is a hard build error** — unless
it's in `KNOWN_MISSING_HIPS`. That map documents HIPs that Stellarium
references but HYG has no 3D position for (empty x/y/z/parallax in the
CSV), with a human-readable justification each. Currently:

- `5165` (α Phe / Ankaa) — Phoenix loses most of its figure without this
  star, but HYG can't carry it.
- `89341` (μ Sgr / Polis) — one Sagittarius polyline degrades from 3
  points to 2, shape still recognisable.

If a future Stellarium update introduces new references to missing HIPs,
the build fails until each is explicitly added to
`KNOWN_MISSING_HIPS` with rationale. Don't relax the check to a soft
warning — the whole point of using Stellarium's HIP-indexed data (vs.
fuzzy RA/Dec position matching) is deterministic mapping.

