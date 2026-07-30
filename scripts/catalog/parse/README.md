# Per-row pipeline and reference-catalogue parsing

The spine row walk (`readStars` in `stars-parse.ts`) and everything it
resolves per star: space-motion velocity, physical radius and spectral
class, the GCVS variability cross-match, and Stellarium stick figures. The
binary record layout these fields land in is `../README.md` § Binary catalog
format; the membership term it walks is `../spine/README.md`.

## Files in this area

```
scripts/catalog/parse/
  stars-parse.ts (+ test)         readStars — the per-row pipeline. The hub
                                  every other subfolder imports.
  read-stars-inputs.ts            The spine path, plus source paths + loaders
                                  for every reference table readStars
                                  consumes, and the mtime set derived
                                  artifacts invalidate against.
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
  corpus-tsv.ts                   Shared TSV header + cell parsing. headerIndex
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

`gaia-xmatch.ts` is the deliberate exception: it streams a 2.5 M-row table
line-by-line and dedups on angular distance, so it carries its own accumulator
with the same header strictness rather than a second copy of this one.

## Per-row pipeline

Each spine row walks through, inside `readStars`. The row arrives with its
`gaia_source_id` already resolved — the native-cell → HIP-cross-walk
precedence and both binding gates ran when the spine was frozen, and
re-running them here would re-decide a binding against reference tables that
have since moved (`../spine/README.md` § The identifier columns are read,
never re-derived).

1. **Bailer-Jones (DR3) distance override** (`applyBailerJonesOverride`
   in `catalog-pure.ts`). See `../distance/README.md` § Multi-layer distance refinement.
2. **HIP2 full-precision distance** for `dist_src=HIP` rows: the same
   value AT-HYG catalogued, re-derived as 1000/plx from
   `data/hipparcos/hip2_van_leeuwen.tsv` so the 4-dp print truncation
   drops out. Gated on HIP2 reproducing AT-HYG's printed distance
   (±1e-3 pc) — HIP 57146's unresolved-binary HIP2 refit (187 mas,
   gof 99, vs AT-HYG's sane 59.9 pc) is the case the gate exists for;
   disagreeing rows keep the curated AT-HYG value. Fires on 1,901 of
   1,903 dist_src=HIP rows.
3. **LMC kinematic override** (`applyLmcKinematicOverride`). See
   `../distance/README.md` § Multi-layer distance refinement.
4. **`MAX_DIST_PC = 50_000` bounded-scope cutoff**
   (`stars-parse.ts`). Drops rows still beyond LMC depth.
5. **Direction resolution** (`resolveDirection` in
   `direction-cascade.ts`) and `xyz = direction × distance` in
   float64. See `../distance/README.md` § Direction resolution.
6. **Spectral classification** (`resolveSpectralInfo`; Sol special-cased
   to curated G2V in `stars-parse.ts` — no HIP/Gaia/SIMBAD key reaches
   it). See § Physical radius and spectral parsing.
7. **Constellation** — positional, from the resolved xyz
   (§ Positional constellation membership). Nothing here sets the
   DESIGNATION's constellation: the spine carries no editorial `con` cell.
8. **Johnson V and absmag** (`resolveVMagnitude`, then
   `apparentToAbsoluteMagnitude` on the distance the whole override stack
   settled). See `../photometry/README.md` § The V cascade. The tier that
   won is kept on the record as `vVia`, because it decides whether the
   magnitude is the system's blend or one component's — companion
   promotion's flux conservation may only subtract a companion's light
   from a blend (`../companions/README.md` § Anchor flux conservation).
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
`v = v_r·û + d·MAS_TO_RAD·(μ_α*·ê + μ_δ·n̂)` from the SAME tier solution
`resolveDirection` selected (`DirectionResolution.src*` fields), so
position and velocity always come from one astrometric solution. The
east/north tangent basis is `equatorialTangentBasis`
(`src/client/util/equatorial-basis.ts`), shared with `directionAtEpoch`,
`companion-promotion.ts`'s sep+PA projection, and the runtime's Tier-1
sky→ICRS orbit projection. μ_α* is cos δ-applied — never divide by cos δ.

Velocity source per row (pinned in build-counts as `velocity*`):

| PM source | Rows routed | Zero-velocity fall-through |
| --- | --- | --- |
| Gaia DR3 5p PM | gaia_5p / gaia_nss_systemic tiers | 2p rows (PM null) |
| HIP2 PM | hip2_saturated / hip2_pm_discrepant tiers | HIP2 row, null PM |
| AT-HYG `pm_ra`/`pm_dec` | athyg_printed tier | blank pm cells |

Radial velocity comes from AT-HYG's `rv` cell (km/s; `rv_src` is Gaia RVS
on the bulk), used directly where present, zero otherwise. **Sol** carries
no PM row and sits at the origin, so its velocity is forced to exactly zero
(the advance pass must leave the world origin fixed).

**Sanity ceiling + escape-velocity ratchet.** `v = d·μ` inflates a noisy
sub-arcsec/yr PM on a faint distant star into thousands of km/s, and a bad
`rv` cell shows up as a nonphysical radial term. Two tracked thresholds
guard this:

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

**Nothing supplies the designation's constellation but a GCVS name.** A
star's *designation* constellation is editorial and diverges from position
once a boundary moves past a named star: ρ Aql / 67 Aql (HIP 99742) is
positionally in **Delphinus** since 1992. AT-HYG's `con` cell used to seed
it; the spine carries no such column, so `desigConIndex` (search-index `dc`)
now starts at `NO_CONSTELLATION_INDEX` on every record and
`designationConIndex(dc, c)` in `../catalog-pure.ts` — the single statement
of which field a Bayer / Flamsteed / GCVS designation reads — falls back to
the positional `conIndex` for all but the GCVS cases below. ρ Aql's aliases
therefore build against Delphinus today. Re-sourcing the field from the
classic-ID overlay's IV/27A constellation, or retiring it, is
`stellata-3bsf.11`.

**A GCVS designation names its own constellation.** "LT Vul" names Vulpecula
whatever any catalogue column says, so `applyVariability` (`gcvs-parse.ts`)
sets `desigConIndex` from the designation's trailing abbreviation —
`gcvsDesignationCon` pins **8,069**, every named variable whose designation
carries one. That the cell it used to correct was untrustworthy both ways is
why the designation is the authority now that it is the only source:

- **Stale** — LT Vul was filed under Sagitta, but sits in Vulpecula *and*
  is named for it, so designation and boundaries agreed against the cell.
- **Right on position, wrong on the name** — RY Cen (cell and position
  both Lupus, named for Centaurus) and EQ Vul (both Lyra, named for
  Vulpecula) are genuine ρ Aql-shaped movers, and were **invisible** to any
  check reading the designation constellation off the cell.

Those two plus CM Ind (named for Indus, positionally in Pavo) are the
**3** entries `designationConMismatch` pins — the whole of `dc` on the wire,
since everything else now agrees with its positional index by construction.

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

## Physical radius and spectral parsing

`resolveSpectralInfo` in `catalog-pure.ts` resolves
`{ classIdx, subclass, lumClass, isWhiteDwarf }` per star via a five-tier
priority chain:

0. **Curated HIP → sp_type override** (`CURATED_SPTYPE_BY_HIP`) —
   saturated stars whose SIMBAD entry is a component-lettered main_id
   carrying neither hip nor source_id, so both machine tiers below miss
   (Castor: '* alf Gem A' A1.5IV). Mirrors the binaries pipeline's
   `component_sptype_overrides.tsv` curated tier. Sol takes the same
   curated route via a proper-name special case in `stars-parse.ts`.
1. **SIMBAD `sp_type` by Gaia source_id** (`data/simbad/simbad_sptype.tsv`
   from `scripts/refresh/refresh-simbad-sptype.py`). SIMBAD canonicalises
   sp_type to Morgan-Keenan only — variability annotations live in `otype`,
   never in sp_type — so the parser (`classifyFromSimbad`) is a strict MK
   walker covering plain MK (`G2V`, `K0III`, `M1.5Iab-b`), white dwarfs
   (`DA`, `DB2`, `DAH`), subdwarfs (`sdB5`), carbon / Wolf-Rayet (`C5,2e`,
   `WN5`), and Am/Ap composites (`kA5hA8mF1(III)SiEuBa` → metallic-line
   type wins).
2. **SIMBAD `sp_type` by HIP** — the same TSV also carries the
   Gaia-saturated bright stars (Algol, Alsephina, Betelgeuse, Rigel, Vega,
   Arcturus, ~700 others) whose SIMBAD row has a valid MK type but **no
   Gaia source_id**, so tier 1's source_id key misses them. `parseSimbadSptypeTsv`
   indexes every row under whichever of source_id / HIP it carries; this
   tier looks up the star's HIP. Without it the radius chain runs the cool
   unknown-Teff fallback against a bright absmag and inflates R ~4× (Algol
   12.47 → 3.2 R☉; Alsephina 12.0 → 4.0). SIMBAD's full MK is preferred
   over GSP-Spec's letter-only enum, so this tier sits above GSP-Spec.
3. **Gaia DR3 GSP-Spec `spectraltype_esphs`** (a column on
   `data/gaia/gaia_dr3_apsis.tsv`, keyed by source_id). Letter-only enum;
   `classifyFromGspspec` maps each letter to its `classIdx` with neutral
   subclass=5 / lumClass=255.
4. **`SPECTRAL_UNKNOWN` fallback** — `classIdx=UNKNOWN_CLASS_IDX` (8) /
   `lumClass=255` for rows no upstream covers.

AT-HYG's contaminated `spect` cell is no longer consulted for
classification (build-counts: ~89% SIMBAD / ~11% GSP-Spec / ~0.4% fallback
against the v3.3 classic-IDs subset); it is still used as a last-resort
hover-display fallback when both upstream sources are blank.

`physicalRadius` then computes R/R☉ via Stefan–Boltzmann:

```
T       = Apsis Teff (gspphot → gspspec) when measured, else
          interp(T_TABLE[classIdx], subclass)
BC      = interp(BC_TABLE[classIdx], subclass)
Mbol    = absmag + BC
L/L☉    = 10^((4.74 − Mbol) / 2.5)
R/R☉    = sqrt(L/L☉) × (T_sun/T)²
```

`resolveApsisTeff` supplies the measured Teff (2–60 kK sanity window);
R ∝ T⁻², so the class-table fallback misized GSP-Spec-tier stars
(letter-only, subclass defaulted to 5) by up to ~36% and unknown-class
stars by up to ~2×. Tables are main-sequence values — cooler for
giants/supergiants in reality — but the Mbol side of the equation
absorbs the luminosity-class difference, so the end result lands close
to published radii (`docs/science-stellar-modelling.md` § Physical radius carries the current
per-star numbers; `known-stars.test.ts` pins them end-to-end via the
corpus `primary_radius_rsun` / `primary_ci` columns). Clamped to
`[0.08, 2500]` so pathological catalog rows don't produce absurd
sizes. White dwarfs are special-cased to 0.013 R☉ (typical WD radius;
absmag doesn't translate reliably for them); Wolf-Rayets ride their
own Teff/BC ramps and ignore Apsis.
