# Catalog build

Single-star catalogue build pipeline: AT-HYG + GCVS + CCDM +
Bailer-Jones + Gaia Apsis + SIMBAD sp_type + Stellarium →
`public/catalog.bin` (v6 binary) + `public/constellations.json` +
`public/search-index.json`. Run via `npm run build:catalog`.

`scripts/catalog/build-catalog.ts` is the orchestrator; the per-row
pipeline lives in `stars-parse.ts` (`readStars`). Per-pipeline algebra
sits in `catalog-pure.ts` (the single source of truth for the v6
binary layout + override math + spectral resolver) and the topic
sub-modules (`direction-cascade.ts`, `gcvs-parse.ts`,
`visual-doubles.ts`, `gaia-xmatch.ts`, `constellations.ts`).

## Per-row pipeline

Each AT-HYG row walks through, inside `readStars`:

1. **Gaia source_id resolution** (`resolveGaiaSourceId` in
   `catalog-pure.ts`). AT-HYG's native `gaia` column wins where
   present; otherwise the HIP cross-walk
   (`data/gaia/gaia_dr3_hip_xmatch.tsv`) supplies it. The HIP
   cross-walk fall-through resolves the ~64 HIP-bearing AT-HYG rows
   whose `gaia` column is blank.
2. **Bailer-Jones (DR3) distance override** (`applyBailerJonesOverride`
   in `catalog-pure.ts`). See § Multi-layer distance refinement.
3. **HIP2 full-precision distance** for `dist_src=HIP` rows: the same
   value AT-HYG catalogued, re-derived as 1000/plx from
   `data/hipparcos/hip2_van_leeuwen.tsv` so the 4-dp print truncation
   drops out. Gated on HIP2 reproducing AT-HYG's printed distance
   (±1e-3 pc) — HIP 57146's unresolved-binary HIP2 refit (187 mas,
   gof 99, vs AT-HYG's sane 59.9 pc) is the case the gate exists for;
   disagreeing rows keep the curated AT-HYG value. Fires on 1,901 of
   1,903 dist_src=HIP rows.
4. **LMC kinematic override** (`applyLmcKinematicOverride`). See
   § Multi-layer distance refinement.
5. **`MAX_DIST_PC = 50_000` bounded-scope cutoff**
   (`stars-parse.ts`). Drops rows still beyond LMC depth.
6. **Direction resolution** (`resolveDirection` in
   `direction-cascade.ts`) and `xyz = direction × distance` in
   float64. See § Direction resolution.
7. **Spectral classification** (`resolveSpectralInfo`). See § Physical
   radius and spectral parsing.
8. **Physical radius** (`physicalRadius`). Stefan-Boltzmann from absmag
   and the resolved (Teff, BC). White dwarfs special-cased to 0.013
   R☉. Clamped to [0.08, 2500] R☉.

AT-HYG's stored `x0/y0/z0` is never consumed: it is a mixed-epoch
merge artifact, tabulated at ~3 dp (a 206 AU grid) and internally
inconsistent with the same row's printed ra/dec by up to tens of
arcsec on high-PM stars (SCIENCE.md § Driver astrometry).

## Direction resolution

`direction-cascade.ts` resolves every row's J2000.0 sky direction
through the same trust cascade the binaries pipeline implements in
`scripts/binaries/stage3_astrometry.py`, sharing its thresholds
(RUWE > 1.4, ipd_frac_multi_peak > 0.02, |ΔPM| > 50 mas/yr):

| Route | Gate | Rows |
| --- | --- | --- |
| `gaia_5p` | Default: the row resolves to a source_id with a 5p row (`data/gaia/gaia_dr3_astrometry_catalog.tsv`, J2016.0) and non-null parallax. Also the fall-through for 2p position-only rows with no HIP2 cover. | ~300.5k |
| `gaia_nss_systemic` | Source has an NSS two-body orbit AND the 5p fit is flagged unreliable (RUWE / ipd). Same Gaia row values — DR3 refits `gaia_source` to the centre of mass for NSS sources — the tag carries provenance parity with Stage 3. | ~10.0k |
| `hip2_saturated` | No usable Gaia parallax (no source_id, no 5p row, or parallax NULL) and HIP2 covers the HIP. The Gaia-saturated bright set: Sirius, Vega, α Cen, Capella, … (J1991.25). | ~2.5k |
| `hip2_pm_discrepant` | Gaia 5p present but Gaia-vs-HIP2 PM disagrees by > 50 mas/yr on either axis — orbit-corrupted 5p PM; HIP2's long baseline is closer to systemic. Unlike Stage 3 there is no ρ ≤ 5″ companion gate (no per-row WDS context at catalog build); the PM discrepancy alone routes. | ~138 |
| `athyg_printed` | Residual: no Gaia astrometry row AND no HIP2 row. AT-HYG's printed ra/dec as-is, unpropagated. ξ UMa (HIP 55203 excluded from HIP2 as orbit-corrupted, Gaia-saturated) is canonical; Sol also lands here. | 30 |

Epoch propagation (`directionAtEpoch`) advances the measured unit
vector linearly along the local east/north tangent basis and
renormalises — exact in cos δ, stable through the poles, <0.001″
error at Barnard's-scale PM over the 16-yr Gaia→J2000 interval.
Radial velocity (perspective acceleration, ≤0.15″ over 16 yr on the
most extreme star) is deliberately omitted; the full tuple belongs
to future current-epoch propagation. μ_α* inputs are the cos
δ-applied rates straight from Gaia/HIP2 — never divide by cos δ.

Missing source files degrade tiers gracefully (empty map → cascade
falls through), and the per-route build-counts pins
(`directionGaia5p` … `directionAthygPrinted`) flag the drift.

The sky-position regression corpus (`sky-position-corpus.tsv` +
`sky-position.test.ts`) pins the canonical high-PM set (Barnard's,
Kapteyn's, Groombridge 1830, 61 Cyg A/B, Keid) plus one row per
non-Gaia tier (Sirius + Vega for hip2_saturated, ξ UMa for
athyg_printed) against published SIMBAD J2000 positions — the
Gaia/HIP2-tier rows land within 0.01″; a PM sign / cos δ /
Δt-direction defect shows up as tens of arcsec.

After the per-row pass: GCVS cross-match (`bridgeGcvsByGaia`), CCDM
visual-doubles flagging (`visual-doubles.ts`), and the 80-byte v6
record write per star including the seven `float32` Apsis fields.
See sections below.

## Full-catalog astrometry request

`export-astrometry-request.ts` (run `npm run build:astrometry-request`)
emits `data/gaia/gaia_catalog_source_id_request.tsv` — the deduped,
numerically-sorted Gaia DR3 source_id for every AT-HYG row, resolved
through the SAME `resolveGaiaSourceId` precedence step 1 uses (native
`gaia` column → HIP cross-walk). It reuses that function directly so
the resolution logic stays defined once; the pure `sortSourceIdsNumeric`
helper (`export-astrometry-request-pure.ts`) does the BigInt sort that
matches the binaries request file's numeric ordering. ~315k source_ids
from the v3.3 classic-IDs subset.

The request drives `scripts/refresh/refresh-gaia-astrometry-catalog.py`,
which pulls the 5p astrometry into
`data/gaia/gaia_dr3_astrometry_catalog.tsv` — the direction-cascade
input (SCIENCE.md § Driver astrometry). This is a superset of the
shipped catalog by the handful of rows dropped at the `MAX_DIST_PC`
cutoff; over-pulling those is harmless.

## Binary catalog format (`public/catalog.bin`)

Fixed-size records, sorted brightest-first by `absmag`. Current version is
**v6** with an 80-byte stride. Magic and version step together
(v3=`HYG3`, v4=`HYG4`, v5=`HYG5`, v6=`HYG6`). v5 appended a `uint64` Gaia
DR3 `source_id` at bytes 44–51 so downstream cross-match (GCVS, CCDM,
NSS, Apsis) can anchor on the same Gaia ID Stellata's source-ID-anchored
pipeline uses everywhere else; ~99.6% of records carry one (the residual
~0.4% are the famous bright binaries Gaia couldn't fit a 5p PM to). v6
appended seven `float32` Gaia DR3 Apsis astrophysical parameters at
bytes 52–79 (gspphot Teff/logg/[M/H]/A0 then gspspec Teff/logg/[M/H]),
keyed by the v5 `gaia_source_id` field — 99.6% of records match an Apsis
row, with non-null Teff in either gspphot OR gspspec on ~85% (the
population the runtime colour-LUT path can re-key from
Ballesteros(B–V) → Apsis-direct).

- Header (32 bytes)
  - 0–3   ASCII `HYG6`
  - 4–7   `uint32` version (currently 6)
  - 8–11  `uint32` count
  - 12–15 `uint32` nameTableOffset
  - 16–19 `uint32` nameTableLength
  - 20–31 reserved
- Record (80 bytes per star)
  - 0–11  `float32 × 3`  x, y, z in parsecs (equatorial, Sol at origin)
  - 12–15 `float32`      absmag
  - 16–19 `float32`      ci (B–V colour index, default 0.65 for missing)
  - 20–23 `float32`      physicalRadius in solar radii (computed at build time)
  - 24–27 `uint32`       companionIdx (record index of binary companion; `0xFFFFFFFF` = none)
  - 28–31 `uint32`       nameOffset (into name table, valid when flag bit 0 set; `0` = none)
  - 32    `uint8`        spectClass (0=O 1=B 2=A 3=F 4=G 5=K 6=M 7=C/S/W 8=?)
  - 33    `uint8`        luminosityClass (0=VII/D … 9=Ia+/0, 255=unknown — see below)
  - 34    `uint8`        constellation index (0–87 into `constellations.json`; 255=none)
  - 35    `uint8`        flags (bit 0=has_name, 1=is_sol, 2=has_bayer, 4=is_binary_primary)
  - 36    `uint8`        **variability amplitude** in 0.05 mag units (0 = not variable)
  - 37    `uint8`        **variability type** (`VAR_TYPE_*`: 0=unknown,
                          1=pulsating, 2=eclipsing, 3=other). Runtime
                          pulsation-suppress for eclipsing binaries
                          with orbital elements reads this paired with
                          `binaries.bin`'s has_orbit flag.
  - 38–39 `uint16`       **variability period** in 0.1 days (0 = not variable, max 6553.5 d)
  - 40–43 `uint32`       **HIP** (Hipparcos number; 0 = no HIP). Only ~37%
                          of the catalogue carries HIP — the rest are filled
                          with 0 and fall back to row-index addressing in
                          shared URLs. Max observed HIP is 120,404 (fits in
                          17 bits) so 24 bits would suffice, but `uint32`
                          keeps the record stride a multiple of 4.
  - 44–51 `uint64`       **Gaia DR3 source_id** little-endian (0 = none).
                          Sourced from AT-HYG's native `gaia` column;
                          rows with that column blank fall back to a HIP→Gaia
                          DR3 cross-walk (Gaia's `hipparcos2_best_neighbour`,
                          loaded from `data/gaia/gaia_dr3_hip_xmatch.tsv`).
                          IDs routinely exceed 2^53 so the JS reader
                          exposes them via `BigUint64Array`. The ~0.4%
                          residual without a source_id is dominated by
                          Gaia-saturated bright binaries (Sirius, Vega,
                          Procyon, …) absent from both AT-HYG and the
                          best-neighbour cross-walk; their orbital
                          rendering flows through `data/binaries/multiples.tsv`
                          instead.
  - 52–55 `float32`      **teff_gspphot** (K) — Gaia DR3 Apsis Teff from
                          gspphot. `NaN` (`NO_APSIS` sentinel) for the
                          ~15% of records absent from gspphot or whose
                          cell was blank. Tested with `Number.isNaN`.
  - 56–59 `float32`      **logg_gspphot** (log cgs); NaN = absent.
  - 60–63 `float32`      **mh_gspphot** ([M/H] dex); NaN = absent.
  - 64–67 `float32`      **azero_gspphot** (mag, line-of-sight extinction); NaN = absent.
  - 68–71 `float32`      **teff_gspspec** (K) — independent Gaia DR3
                          Apsis Teff from gspspec. gspphot and gspspec
                          are independent solutions; consumers preferring
                          Apsis-direct Teff typically use gspphot first,
                          gspspec as fallback. NaN = absent.
  - 72–75 `float32`      **logg_gspspec** (log cgs); NaN = absent.
  - 76–79 `float32`      **mh_gspspec** ([M/H] dex); NaN = absent.
- Name table: length-prefixed UTF-8 strings (`uint16` length then bytes).
  **Offset 0 is reserved** as the "no name" sentinel (2 zero bytes of
  padding); real names start at offset ≥ 2.

Luminosity class encoding (Morgan–Keenan):
`0=VII/D (white dwarf), 1=VI/sd, 2=V (dwarf), 3=IV (subgiant), 4=III
(giant), 5=II (bright giant), 6=Ib, 7=Iab, 8=Ia, 9=Ia+/0 (hypergiant),
255=unknown`.

Amplitude encoding saturates at 255 × 0.05 = 12.75 mag; periods over
6553.5 days clamp to the uint16 max. Both limits cover the vast
majority of real variables (a few multi-decade symbiotics and extreme
eclipsers clip but those render imperceptibly slowly anyway).

The byte plan above is encoded once in `scripts/catalog/catalog-pure.ts` as
`HEADER_LAYOUT`, `RECORD_LAYOUT`, `HEADER_SIZE`, `RECORD_SIZE`, `MAGIC`,
`BINARY_VERSION`, `NO_COMPANION`, and `NO_APSIS`. Writer
(`scripts/catalog/build-catalog.ts`), runtime reader
(`src/client/loaders/catalog-loader.ts`), and the verify tool
(`scripts/catalog/verify-catalog.ts`) all index off those constants —
there are no inline byte offsets to drift apart. If you add fields,
extend `RECORD_LAYOUT` and **bump `BINARY_VERSION` + `MAGIC`** in
`catalog-pure.ts`. Free flag bits today are `0x40`, `0x80` (see
`FLAG_*` exports). `0x08` is `FLAG_BINARY_COMPANION_ONLY` — set on
records added by `companion-promotion.ts`. `0x20` is
`FLAG_BINARY_COMPANION_SYNTHETIC` — set additionally when the
promoted record's only addressable identifier is a synthetic key
(`synth-<wds_id>-<comp>`) because the multiples.tsv row carries
no own gaia and no non-inherited HIP (Algol Ab, the Aa1,2 WDS-
truncated secondary, and the inherited-HIP escape's after-
stripping output land here). Bits come from the
`RESERVED_FLAG_BITS` pool — no `BINARY_VERSION` bump needed.
Layout consistency is pinned by the `binary-format constants`
block in `scripts/catalog/catalog-pure.test.ts`.

The build script also asserts every headline count (record count, GCVS
xrefs, binary inference output, CCDM doubles, name-table entries,
search-index entries, etc.) against
`scripts/catalog/build-catalog-expected.json` at the end of each run. A
deliberate change refreshes the manifest with
`UPDATE_BUILD_COUNTS=1 npm run build:catalog`; an unintended drift
exits non-zero with a per-key diff. `scripts/catalog/build-counts.ts` carries
the pure comparator + formatter and has its own vitest coverage.

## Search index (`public/search-index.json`)

Separate from `catalog.bin` so the main binary stays rendering-focused.
One JSON array entry per star that has at least one searchable identifier
(proper name, Bayer, Flamsteed, HIP, HD, HR, or Gliese). Short keys
(`i/p/b/f/hip/hd/hr/gl/c/s`) to keep wire size down — file is ~13 MB raw,
~2 MB gzipped. Loaded in parallel with `catalog.bin` in `main.ts`. The
`s` field carries the raw spectral designation from the AT-HYG source
("G2 V", "M1.5Iab-b", "K0III+K7V", …) for the hover tooltip display.

Field shape pinned in `scripts/catalog/catalog-pure.ts` as the `SearchEntry`
interface — the writer (`build-catalog.ts`) and the reader
(`src/client/search.ts`) both import it; drift = compile error.

Identifier dispatch in `search.ts`:
- Regex-prefix forms (`HIP 27989`, `HD 39801`, `HR 2061`, `Gl 559A`) go
  through `Map<number, number>` direct lookups — no fuzzy scoring.
- Flamsteed (`58 Ori`) also uses a direct `"${num} ${con}"` map.
- Everything else (proper name, Bayer forms) is Fuse-fuzzy.
- For each Bayer'd star, multiple index entries are emitted so any of
  `α Cen` / `Alpha Cen` / `Alp Cen` / `Alf Cen` / `Alpha Centaurus` find
  the star. "Alf" is added only for α (most-commonly alternate-spelled).

The dropdown deduplicates by star index so a star with multiple matching
Bayer variants shows up once.

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
`{ classIdx, subclass, lumClass, isWhiteDwarf }` per star via a four-tier
priority chain, keyed first on the Gaia DR3 `source_id` then on HIP:

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
T       = interp(T_TABLE[classIdx], subclass)
BC      = interp(BC_TABLE[classIdx], subclass)
Mbol    = absmag + BC
L/L☉    = 10^((4.74 − Mbol) / 2.5)
R/R☉    = sqrt(L/L☉) × (T_sun/T)²
```

Tables are main-sequence values — cooler for giants/supergiants in reality
— but the Mbol side of the equation absorbs the luminosity-class
difference, so the end result lands close to published radii (Sol≈1.03,
Sirius≈1.81, Vega≈2.68, Rigel≈75, Betelgeuse≈700, all within ~10% of
canonical values). Clamped to `[0.08, 2500]` so pathological catalog
rows don't produce absurd sizes. White dwarfs are special-cased to
0.013 R☉ (typical WD radius; absmag doesn't translate reliably for them).

## Geometric binary inference

`inferBinaries` in `build-catalog.ts` runs after the absmag sort so record
indices are final. Spatial grid keyed at `BINARY_MAX_SEP_PC = 0.005 pc`
(≈1030 AU) using a three-axis hash; for each star, check own cell + 26
neighbours and record the nearest neighbour within the threshold.

Why this threshold: at the current `minDistance = 0.005 pc` orbit,
anything farther than that subtends >45° from the camera — it wouldn't
fit the viewport as a visual "system", which is what the render layer
wants. Wider bound pairs exist in the catalog but won't render usefully.

What you'll see from the classic_ids subset: ~14 pairs. Feels low but is
accurate. The subset selects stars with classical designations, and most
"wide binary" companions in physically-bound pairs don't have their own
classical ID — the brighter primary does. The pairs we do find are
almost all famous named visual binaries (α Cen A/B, Alula Australis,
Struve 2398, etc.). Reaching thousands of pairs would require the fuller
`reduced_m10` subset, which has a different selection profile.

Each star records its **directed** nearest in `companionIdx`: A's
nearest may be B while B's nearest is some third star C. The
relation is one-way. The renderer reads this as "the partner to keep
in frame" (zoom-fit, disc-mask), which is well-defined even when
asymmetric.

Flag bit 4 (`0x10`) is stricter: set only on the **brighter member of
a mutual pair** — A↔B where each is the other's directed nearest.
Mutual-only avoids over-flagging in dense clusters where a star's
directed nearest happens to be a third star already paired with
someone else, and ensures the chart-mode wings glyph appears once
per system on the canonical anchor.

## Companion promotion from `data/binaries/multiples.tsv`

`companion-promotion.ts` runs BEFORE the absmag sort. It reads the
binaries pipeline output and adds first-class catalog records for
the secondary of every physical pair whose identifier isn't already
in AT-HYG. ~8.6k companions promoted into the current build
(Sirius B, Achird B, Porrima B, Fomalhaut C, Algol Ab, …) — about
half via real Gaia/HIP keys, half via synthetic identifiers (see
the identifier gate below).

Per-row gates and resolution:

- **WDS unresolved-compound guard.** Secondary rows whose `comp` letter
  is an unresolved compound aggregate ("BC" / "AB" / "ABC") — every
  character appears as a single-letter comp on a sibling cursor in the
  same WDS root — drop early without promotion. 40 Eri's `A,BC` row
  carries `comp="BC"`, and the WDS root also has resolved `BC` /
  `AC` cursors with single-letter primaries B and C; the relational
  test confirms "BC" is shorthand for the unresolved B+C aggregate and
  not a single star. Promoting it would add a "Keid BC" record at
  ~416 AU from Keid alongside the resolved Keid B and Keid C, double-
  counting the BC pair's light + position.
- **Identifier.** Real-ID resolution (gaia first, then hip)
  attempts to match the row against an existing catalog star;
  skip when it hits a row that ISN'T the system primary
  (alreadyInCatalog). When the row carries no own gaia AND no
  own hip, mint `synth-<wds_id>-<comp>` and proceed —
  `FLAG_BINARY_COMPANION_SYNTHETIC` flags the result. Same path
  fires when the inherited-HIP or inherited-Gaia escapes strip
  the row's ids to null, since the final record has nothing else
  addressable. Algol Aa,Ab + Aa1,2 are the canonical surfacing
  cases. The Gaia escape mirrors the HIP one: Gaia fits one
  source to a blended sub-arcsec pair, so both component rows
  carry the primary's source_id (2090 pairs) — the companion
  strips it rather than colliding with the primary in every
  gaia-keyed lookup, and build-runtime-binaries retries the
  synth key when its id-first resolve degenerates.
- **Cursor-primary anchor.** findExistingPrimary walks gaia →
  hip → proper name (position-guarded, for GJ-only AT-HYG rows
  carrying neither id — ξ UMa A). An unresolvable primary would
  otherwise run its whole cursor anchor-less.
- **Collocated AT-HYG double merge.** When the composed companion
  name matches an existing record sitting bit-identical on the
  anchor (AT-HYG carries both members of a resolved pair at the
  same printed blend coordinates — ξ UMa's "Alula Australis" +
  "Alula Australis B" is the only case in the catalog), that
  record IS the companion: it is repositioned in place (gaia
  backfilled from the row) instead of minting a duplicate.
- **Position.** Prefer the row's own xyz when its astrometry is a
  real per-component fit AND its xyz differs from the primary row's
  xyz. Else apply a sky-tangent projection from the EXISTING catalog
  primary's xyz at the published WDS sep+PA — anchoring on the
  catalog primary (not the multiples.tsv primary row) avoids a
  pipeline-precision gap between AT-HYG's 3-4 sig figs and the
  binaries pipeline's 6 sig figs (Sirius A and B were ~100 AU apart
  for that reason before the fix). Sub-resolution / unmeasured
  pairs (WDS ρ 0.000 or the −1 sentinel) have no static placement
  to bake: with a renderable orbit the secondary collocates
  BIT-IDENTICALLY on the anchor — the zero baked diff is the
  runtime's signal to render the offset as R(t) around the primary
  (src/client/binaries/orbit-relation-cache.ts collocated-bake) —
  and without one the row drops (droppedNoPosition): nothing would
  ever separate the records and the collocated star double-counts
  the blend photometry.
- **Position for pair-row primaries.** When the cursor primary itself
  needs promotion (40 Eri B — primary in BC/BD/BE, never a secondary
  of A), position resolves in preference order: (1) the row's own
  per-component astrometry when Stage 3 supplied a real independent fit
  (own `gaia_5p` / `hip2_long_baseline` whose id differs from the
  anchor's); (2) project off a sibling cursor's compound sep+PA whose
  compound contains this row's comp letter — 40 Eri B borrows the A,BC
  group's 83.2″ / 108° A→BC sep+PA as the best available A→B proxy.
  Neither available → **drop** (`droppedCollocatedPrimary`). Collocating
  on the anchor would bake a false coincident star inside the anchor's
  disc (δ Vel C): the escape only fires for cursor primaries that never
  appear as a secondary of the anchor, so no anchor→self orbital pair
  exists for `BinaryOrbitField` to animate it away from centre at
  runtime.
- **Absmag.** Preference order: `primary_absmag + WDS Δmag` when the
  row inherited its parent's AT-HYG photometry (Sirius B's row
  carried Sirius A's 1.45 absmag, not the WD's 11.36); the row's own
  (non-inherited) absmag; primary + Δmag fallback; class→M_V from a
  per-component spectral type (`absmagFromSpectral`, spect_via
  curated/simbad — Algol Aa2's curated K0IV lands at 3.30 vs the
  primary's −0.11). A row with inherited photometry, no Δmag, and
  no per-component type has NO honest brightness source: returning
  the inherited value minted full-luminosity twins (Betelgeuse Ab).
  Those rows drop — unless the pair carries a renderable orbit
  binaries.bin must keep addressing, where the twin is kept and
  counted (`companionAbsmagInheritedTwinOrbital`, a ratchet-down
  metric: curate types to shrink it). For a **pair-row-primary
  escape** the row's Δmag describes the sub-pair it heads, not the
  anchor→row separation (40 Eri B's Δmag is the B→C delta), so both
  `primary + Δmag` paths are suppressed; absent own / per-component
  photometry the record inherits the anchor's collocated brightness
  (`companionAbsmagAnchorCollocated`) rather than a corrupted A+Δmag.
- **B-V (ci).** Same inheritance-detection trick: when the row's
  ci matches the primary's exactly, recompute from the spectral
  info via `tempKelvin → ballesterosBvFromTeff`. Sirius B's DA1.9
  stores ci = -0.443 (deep blue at the LUT) rather than the
  inherited 0.009 white.
- **Spectral / lum class.** From `classifyFromSimbad(row.spect)` —
  the multiples.tsv row carries SIMBAD's per-component sp_type
  when available (DA1.9 for Sirius B, K7Ve for Achird B). Falls
  back to `SPECTRAL_UNKNOWN` if unparseable.
- **HIP inheritance gate.** When the row's HIP equals the primary
  row's HIP, set `hip = null` on the promoted record. Hipparcos
  resolved the system as one star and the HIP belongs to the
  brighter component; inheriting it would collide with the
  primary in every HIP-keyed lookup (url-state's `refFromIndex`
  notably).
- **Proper name.** Compose as `<primary_proper> <comp>` —
  "Sirius B", "Achird B", "Porrima B". The secondary's own `name`
  cell wins when populated (source=athyg); the primary row's name
  is the fallback when the secondary's row is source=wds with no
  AT-HYG entry of its own.

Promoted records carry `FLAG_BINARY_COMPANION_ONLY = 0x08`, and
additionally `FLAG_BINARY_COMPANION_SYNTHETIC = 0x20` when the
record lacks own gaia/hip and is addressed exclusively through a
`synth-<wds_id>-<comp>` key. They're pushed onto `stars` before
the absmag sort so they receive the same final record indexing as
everything else. The post-sort `buildCatalogRowIndexMap` emits
`public/catalog-row-index-map.json` with three sections —
`byGaia`, `byHip`, `bySynth` — which lets the runtime binaries
layer resolve multiples.tsv rows back to catalog.bin records in
that priority order.

The companion-promotion path is the seam where bugs in the
binaries pipeline become user-visible. The Tier A regression
corpus in `known-stars.tsv` pins Sirius B's record specifically
(addressed by gaia_source_id, no HIP) as a stand-in for the
broader category.

### Component-letter stamping

`stampComponentLetters` runs immediately after `promoteCompanions`
(over the same grouped `multiples.tsv` rows `promoteCompanions`
returns), before the absmag sort and the name-table / search-index
write. Promotion only ADDS records; when BOTH halves of a pair
already exist as first-class AT-HYG rows AND neither carries a
`proper` name, they render with identical Bayer/Flamsteed labels and
are individually unsearchable (61 Cyg A and 61 Cyg B both print
"61 Cyg"). For each system where ≥2 **distinct** first-class
(non-promoted) AT-HYG records resolve and none is already named, the
pass writes `<base> <comp>` into each record's `proper` (base via
`resolveCompanionNameBase`) and sets `FLAG_HAS_NAME`. Components are
deduped by record index: a blended single entry whose rows share one
identifier (no own gaia + shared HIP) resolves to one record and is
skipped — it is one star, not two components, and must not be
mislabelled as its faint secondary. It also **skips** any system
where a component already carries a real `proper` (never rename
Sirius A → "Sirius A") or where the primary yields no usable base.
`componentLettersStamped` counts the records renamed.

## GCVS variability cross-match

`parseGcvsMain` + `parseGcvsCrossref` in `build-catalog.ts` read two
files from `data/`:

- `gcvs5.txt` — pipe-delimited fixed-width; we pull the GCVS designation,
  period (days), and magnitude amplitude (from max-mag / min-mag-I).
  Rows without a parseable period, or with zero amplitude, are skipped
  (constant stars, supernovae, irregular variables we can't render
  periodically).
- `crossid.txt` — maps foreign-catalogue IDs (`Hip nnnn`, `HD nnnn`, …)
  to GCVS designations. Only `Hip` and `HD` are extracted since AT-HYG
  carries those.

`applyVariability` then walks the post-sort catalog and for each star
tries HIP first, HD fallback, to find a GCVS name, then looks up the
period+amp. Typical match rate: ~3.7k out of 313k classic_ids stars —
most catalog stars aren't variable, but the ones that are tend to be
the astronomically interesting ones (Betelgeuse, Mira, Algol,
Cepheids, etc.).

Both GCVS files are tracked via Git LFS rather than downloaded at build
time — they update rarely (yearly-ish). If bumping to a new GCVS
version, re-download from http://www.sai.msu.su/gcvs/ and replace the
existing files; LFS handles the large-blob storage on push.

## CCDM double-star cross-match

Visual binaries get the same `flags` bit 4 the geometric pass uses, so
chart mode renders wings on either source with no renderer-side
changes. The geometric pass alone yields ~14 pairs (the only AT-HYG
rows where both components survive the classic-IDs cut); the CCDM
pass pulls in everything else where the primary has a HIP — Sirius,
Mizar, Castor, α Cen, Polaris, Albireo, γ And, ε Lyr, etc.

`parseHipCcdm` in `build-catalog.ts` reads `data/hipparcos/hip_ccdm.tsv`, a
three-column slice of the **Hipparcos main catalogue** (VizieR
`I/239/hip_main`). The `CCDM` column on each Hipparcos row carries
the cross-reference into the Catalog of the Components of Double
and Multiple stars (Dommanget & Nys 1994), the curated pre-WDS
register of visual doubles. CCDM alone is too permissive — it
lumps physical pairs together with wide line-of-sight optical
pairs that happen to land near each other on the sky, so flagging
on `CCDM != ""` alone tags Vega, Pollux, and ~19k other stars
including a substantial optical-pair tail.

To gate optical pairs out, we additionally filter on Hipparcos's
own `MultFlag` (H59) column:

| `MultFlag` | Meaning                                | Action |
|------------|----------------------------------------|--------|
| `C`        | Component star in a Hipparcos system   | keep   |
| `G`        | Double resolved within Hipparcos field | keep   |
| `O`        | Orbit known (spectroscopic / astrom.)  | keep   |
| blank      | CCDM listed but Hipparcos didn't model | drop   |
| `V`        | Variability-induced double             | drop   |
| `X`        | Stochastic, low confidence             | drop   |

This drops the bulk of optical pairs while preserving every
binary Hipparcos itself confirmed.

A handful of canonical visual doubles fall through the gate
because Hipparcos modelled them as single stars (`Ncomp=1`,
blank `MultFlag`) — typically wide pairs where the secondary is
faint or angularly outside what Hipparcos resolved.
**`KNOWN_VISUAL_DOUBLES`** in `build-catalog.ts` recovers them
unconditionally. The structure is a list of `{components, reason}`
systems — each entry is one physical system whose `components`
array is the HIPs known to belong to it (one or more) plus a
human-readable justification. The same primary-only flagging that
applies to real CCDM groups applies here, so 61 Cyg A and B share
one entry rather than two and only the brighter (A) gets the
wings glyph. Current list: Polaris (sep 18″ Polaris B), ε¹ Lyr
(inner pair 2.4″), 61 Cyg A+B (the famous nearby K-dwarf pair).
Visual review of new chart-mode renders may surface more — extend
conservatively.

Why this and not TDSC or WDS directly:

- **TDSC** (Fabricius et al. 2002) is built from Tycho-2, which
  saturates on the brightest stars (V ≲ 3) — Sirius, Mizar, Castor,
  α Cen, Polaris are all *missing* from TDSC. CCDM has no such gap.
- **WDS** itself doesn't carry HIP. Doing positional matching
  ourselves would invite false positives in dense fields. CCDM
  side-steps that by giving us the HIP↔system mapping pre-built.

The file is a VizieR TSV fetched once from
`vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=I/239/hip_main&-out=HIP,CCDM,MultFlag&-out.max=unlimited`
and committed via Git LFS. The parser tolerates VizieR's preamble
(`#` comment lines, header row, dash-separator row). Required
columns are the literal labels `HIP`, `CCDM`, and `MultFlag`; if a
future fetch renames them the build fails with a clear message
naming the actual header that was read.

No separation gate at the per-row level (CCDM and Hipparcos's
`rho` column are both inconsistently populated). The chart-mode
wings glyph is iconic rather than a depiction of resolved pair
geometry, so even Sirius B at ΔV ≈ 10 earns wings on Sirius A.

`parseHipCcdm` returns systems grouped by `CCDM_ID` (real CCDM
strings for file-driven entries, synthetic `OVERRIDE-N` keys for
the `KNOWN_VISUAL_DOUBLES` list). `applyDoublesFlag` then walks
each group, picks the **brightest** catalog member (lowest
`absmag`), and ORs `0x10` onto only that one — so each Hipparcos-
resolved system contributes exactly one chart-mode wings glyph,
matching the geometric pass's mutual-primary semantics. Stars that
are CCDM secondaries do not get the bit; they remain in the
catalog with their other flags intact. No `companionIdx` write —
the secondary often isn't in the AT-HYG classic_ids subset, and
the renderer's zoom-fit code at `stellata.ts` already guards on
`companion ≥ 0`, so a flagged-but-unpaired primary is fine.

If the CCDM file is absent the build logs and continues — the
geometric pass still runs and chart mode still works, just with the
~14-pair coverage.

## Multi-layer distance refinement

Every star's final distance is the output of an ordered three-layer
stack run inside `readStars` (`scripts/catalog/stars-parse.ts`). The
order is non-commutative — see SCIENCE.md § Stellar catalog ingestion
§ Multi-layer distance refinement for the physical rationale; the
diagram below is the build-side view:

```
AT-HYG `dist` column  (whatever dist_src carries)
   │
   ▼
[ Layer 1: Bailer-Jones DR3 override ]   only for dist_src ∈ {G_R3, G_R2}
   │                                       AND gaia_source_id resolved
   │                                       AND bjMap has the source_id
   ▼
[ HIP2 full-precision re-derivation  ]   only for dist_src = HIP, and only
   │                                       when 1000/plx reproduces AT-HYG's
   │                                       printed dist (± 1e-3 pc) — same
   │                                       value, 4-dp truncation dropped
   ▼
[ Layer 2: LMC kinematic override    ]   only inside 15° LMC cone
   │                                       AND |Δμ_α*|, |Δμ_δ| ≤ 0.5 mas/yr
   ▼
[ Layer 3: MAX_DIST_PC = 50,000 gate ]   drops anything still beyond LMC
   │
   ▼
dist × cascade direction (§ Direction resolution) → `public/catalog.bin` xyz
```

Each override layer returns a `DistanceOverride` (`dist`, `absmag`) —
the absmag recompute matters because skipping it places the star at
the new distance but lights it at the old one, breaking the disc/glow
size chain in the renderer. Position is assembled afterwards as
`direction × dist` (§ Direction resolution), so the overrides carry
no xyz. Both override helpers (`applyBailerJonesOverride`,
`applyLmcKinematicOverride`) live in `catalog-pure.ts` so the algebra
is testable in isolation (`catalog-pure.test.ts`).

### Layer 1 — Bailer-Jones (DR3) override

`scripts/catalog/build-catalog.ts` swaps AT-HYG's naive `1 / π`
distances for the Bayesian posteriors published by Bailer-Jones et
al. 2021 (CDS I/352). The pipeline:

1. Load `data/bailer-jones/bailer-jones-dr3.tsv` via
   `parseBailerJonesTsv` into a `Map<source_id, distance_pc>` keyed
   by Gaia DR3 `source_id`. The key is kept as a **string** — Gaia
   source_ids regularly exceed `Number.MAX_SAFE_INTEGER`, so any
   numeric parse would silently corrupt the join. Photogeometric
   `r_med_photogeo` is preferred; `r_med_geo` is the fallback when
   photogeo is absent.
2. During `readStars`, every AT-HYG row with a non-empty `gaia`
   source_id AND `dist_src ∈ {G_R3, G_R2}` is looked up in the map.
   The eligibility predicate `isBailerJonesEligible` is the single
   gate; rows with `dist_src ∈ {HIP, GJ, N, OTHER}` are excluded
   deliberately (their distances are non-Gaia parallaxes B-J would
   silently regress onto its Galactic prior tail).
3. On a hit, `applyBailerJonesOverride` returns
   `{ dist, absmag }` with `absmag = mag − 5·log₁₀(dist / 10)`.
4. The override fires for ~99.5% of Gaia-DR3-bearing AT-HYG rows.
   The residual ~0.5% are source_ids absent from the Bailer-Jones
   publication and keep their AT-HYG values unchanged.
5. The build also rescues ~15 stars previously dropped at Layer 3:
   catastrophic-parallax-inversion supergiants whose Bayesian
   distance falls below the cap.

If `data/bailer-jones/bailer-jones-dr3.tsv` is absent (fresh clone
without LFS pulled), the build logs and continues — every star keeps
its naive AT-HYG distance. Data refresh: `npm run refresh:bailer-jones`.

### Layer 2 — LMC kinematic override

Bailer-Jones's Galactic-density prior doesn't cover the LMC, so the
~60 AT-HYG LMC supergiants (HDE 268xxx range) land somewhere
intermediate (5–20 kpc) after Layer 1 instead of the LMC's true
~50 kpc. Layer 2 identifies these stars by sky-cone + bulk proper
motion and snaps their distance to the eclipsing-binary anchor in
Pietrzyński et al. 2019 (49.594 kpc).

Constants in `catalog-pure.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `LMC_DISTANCE_PC` | 49,594 | Pietrzyński 2019 LMC centre-of-mass distance. |
| `LMC_CENTRE_RA_HOURS` | 5.25067 (= 78.76°) | LMC photometric centre RA. |
| `LMC_CENTRE_DEC_DEG` | −69.19 | LMC photometric centre Dec. |
| `LMC_CONE_HALF_ANGLE_DEG` | 15 | Sky-cone half-angle. |
| `LMC_PM_RA_CENTRE` | 1.85 mas/yr | van der Marel & Kallivayalil 2014 LMC bulk μ_α*. |
| `LMC_PM_DEC_CENTRE` | 0.20 mas/yr | Same paper, μ_δ. |
| `LMC_PM_TOLERANCE` | 0.5 mas/yr | Per-axis tolerance around the bulk PM. |

`isInLmcCone(raHours, decDegrees)` evaluates the cone independently
of the PM gate so `readStars` can count cone-membership candidates
(`lmcCandidates` in `build-counts-expected.json`) separately from
PM-passing overrides (`lmcOverridden`). The override fires for ~54
of ~60 candidates each build; the residual ~6 fail the PM tolerance
(MW halo / runaway stars whose PMs sit far from the LMC bulk
centroid).

The override **must** run after Layer 1: LMC supergiants typically
carry Gaia source_ids that B-J's map covers, so Layer 1 fires on
them first with a mis-anchored intermediate distance. If Layer 2 ran
first, Layer 1 would clobber its snap back to that intermediate
value. The codepath in `readStars` enforces this by sequencing the
calls; the regression test `catalog-pure.test.ts` pins the LMC
constants and the override math.

### Layer 3 — MAX_DIST_PC bounded-scope cutoff

`MAX_DIST_PC = 50_000` (defined at `stars-parse.ts:34`) drops any row
whose final distance still exceeds 50 kpc after Layers 1 and 2. This
is **not** a noise filter — it's a statement about which populations
the model currently represents (Sol out to and including the LMC).
The cutoff bumps in sync with each new modelled population the
renderer takes responsibility for (future SMC, Sgr dSph, M31
supergiant layers would extend it). See SCIENCE.md § Stellar catalog
ingestion for the framing rationale.

### Post-build distance-regression check

After the binary is written, `scripts/catalog/distance-regression-check.ts`
sweeps the catalogue and emits two snapshot sections into
`scripts/catalog/build-distance-outliers-expected.json`:

- **Self-consistency outliers** — stars whose final distance has
  drifted from their AT-HYG input beyond per-`dist_src` thresholds
  (`HIP`/`GJ`/`N`: 3× ratio; `G_R3`/`G_R2`: 30× ratio since B-J
  legitimately re-anchors low-S/N Gaia parallaxes).
- **SIMBAD-anchored outliers** — stars whose final distance disagrees
  with SIMBAD's parallax-derived distance by more than 5× on the
  random 10k stratified sample in `data/simbad/simbad_sample.tsv`.

Both sections carry hand-edited `reason` strings ("LMC kinematic snap
legitimate", "ρ Cas yellow hypergiant — SIMBAD's 1/π is the noisy
Hipparcos value") that survive `UPDATE_DISTANCE_OUTLIERS=1` refreshes
via `mergeReasonsFromSnapshot`. A new outlier fails the build until
the snapshot is refreshed and a rationale is filled in; a removed or
changed outlier likewise.

## Gaia DR3 Apsis surfacing

`scripts/catalog/build-catalog.ts` loads
`data/gaia/gaia_dr3_apsis.tsv` via `parseGaiaApsisTsv` into a
`Map<source_id, ApsisRow>` and writes seven `float32` Apsis fields
per record into the v6 binary (offsets 52–79; see § Binary catalog
format above). Coverage: ~99.6% of records that resolve to a Gaia
source_id match an Apsis row; ~85% have a non-null Teff in either
gspphot or gspspec. The remaining ~15% (typically faint Tycho-only
stars without high-S/N BP/RP photometry, plus hot O/B stars where
gspphot doesn't converge) are written as `NaN` (the `NO_APSIS`
sentinel) and the spectral resolver falls through to GSP-Spec's
letter-only enum or the unknown-class fallback.

The seven floats are surfaced directly to the runtime via
`catalog-loader.ts`'s per-array views (`teffGspphot`, `loggGspphot`,
`mhGspphot`, `azeroGspphot`, `teffGspspec`, `loggGspspec`,
`mhGspspec`). Consumers test absence with `Number.isNaN(arr[i])`.
Today's downstream consumers:

- **Per-star intrinsic Teff routing** (`src/client/star-pipeline/star-color-routing-pure.ts`)
  — six-tier `pickTeffSource` ramps gspphot first, gspspec second,
  Ballesteros(B-V) third, spectral-class T_TABLE fourth, WD Sion Teff
  fifth, solar fallback last.
- **Spectral classification fall-through** (`resolveSpectralInfo` in
  `catalog-pure.ts`) — when SIMBAD has no sp_type under either the
  source_id or HIP key, GSP-Spec's `spectraltype_esphs` enum is the
  tier before `SPECTRAL_UNKNOWN`.
- **Per-record handles** for future Phase 5 consumers (geometric
  occlusion photometry's limb-darkening Teff dependence; mass-ratio
  refinement using direct `logg_gspphot` for giant / subgiant
  classification) — already loaded; no rebuild needed when those
  consumers come online.

Data refresh: `npm run refresh:gaia-apsis`. See SCIENCE.md
§ Astrophysical parameters from Gaia DR3 Apsis for the science
framing.

## Validation harness

Three tiers, all snapshot-pinned:

- **Tier A — known-stars corpus.** `scripts/catalog/known-stars.tsv`
  carries ~50 hand-curated systems (single stars + multiples) with
  expected HIP, Gaia DR3 source_id, distance ± 1σ, absmag, spectral
  type, and per-companion (HIP, source_id, absmag) tuples.
  `scripts/catalog/known-stars.test.ts` loads `public/catalog.bin` via
  the runtime loader and asserts every row matches within tolerance.
  Adding a row → see § Adding to the known-stars corpus below.
  The sky-position corpus (`sky-position-corpus.tsv` +
  `sky-position.test.ts`, § Direction resolution) is the companion
  Tier A harness for single-star angular placement.
- **Tier A — multi-star geometry corpus.**
  `scripts/catalog/multi-star-regression.tsv` +
  `multi-star-regression.test.ts` pin per-PAIR geometry against
  external truth (WDS sep+PA at the published epoch, ORB6 periods):
  catalog.bin tangential separation + PA between the two component
  records, the multiples.tsv geometry columns, the binaries.bin
  Tier-1 record (flags, elements, stored sep/PA/epoch), and a Kepler
  propagation to each record's own `sep_pa_epoch_jd` through the same
  pure path the runtime baseline cache uses. Also sweeps identifier
  integrity: corpus-wide HIP distinctness, URL star-ref round-trips
  (first-seen `hipToIndex` semantics matching `main.ts`), and a
  pinned-count ratchet on promoted-companion HIP collisions. Column
  contract + per-row tolerance discipline live in the TSV header.
- **Tier B — population statistics.**
  `scripts/catalog/build-counts.ts` (`compareBuildCounts`) + the two
  per-build snapshot JSONs gate every absolute count and rate the build
  emits. The diff format in `formatCountDiff` is the same in both Phase
  2 and Phase 3 — `scripts/binaries/stage7_counts.py` mirrors
  `scripts/catalog/build-counts.ts` so the per-strategy assertion shape
  reads identically across the two builds.
- **Tier C — SIMBAD random sample.**
  `scripts/catalog/validate-simbad-sample.ts` cross-checks the built
  `public/catalog.bin` against a stratified random 10k SIMBAD sample
  in `data/simbad/simbad_sample.tsv`. Manual run; the
  distance-regression check above is the build-time automated subset
  of the same cross-check.

## Adding to the known-stars corpus

`scripts/catalog/known-stars.tsv` is tab-separated with comment lines
preserved. To add a star or system:

1. Pick the system. Confirm the WDS id (empty for single stars), the
   primary HIP and Gaia DR3 source_id (`SIMBAD` or VizieR resolve), a
   trusted distance ± 1σ, the expected absmag, and the MK spectral type.
2. For multiples, list each companion's letter, HIP, source_id, and
   absmag in the `companions` column as
   `comp_letter:hip:gaia_id:absmag` tuples joined by semicolons.
3. Append the row. Run `npm test -- known-stars` to confirm the row
   passes against the current `public/catalog.bin`. The test parses the
   spectral string via `classifyFromSimbad` so the format must be
   SIMBAD-canonical MK.
4. If the test fails on a row you expected to pass, the discrepancy is
   genuine — either the catalog has a bug or the expected values are
   wrong. Don't relax the tolerance to silence; investigate.
