# Catalog build

Single-star catalogue build pipeline: AT-HYG + GCVS + CCDM +
Bailer-Jones + Gaia Apsis + SIMBAD sp_type + Stellarium →
`public/catalog.bin` (v8 binary) + `public/constellations.json` +
`public/search-index.json`. Run via `npm run build:catalog`.

`scripts/catalog/build-catalog.ts` is the orchestrator; the per-row
pipeline lives in `stars-parse.ts` (`readStars`). Per-pipeline algebra
sits in `catalog-pure.ts` (the single source of truth for the v8
binary layout + override math + spectral resolver) and the topic
sub-modules (`direction-cascade.ts`, `gcvs-parse.ts`,
`visual-doubles.ts`, `gaia-xmatch.ts`, `constellations.ts`).

## Per-row pipeline

Each AT-HYG row walks through, inside `readStars`:

1. **Gaia source_id resolution** (`resolveGaiaSourceId` in
   `catalog-pure.ts`). AT-HYG's native `gaia` column wins where
   present; otherwise the HIP cross-walk
   (`data/gaia/gaia_dr3_hip_xmatch.tsv`) supplies it. The HIP
   cross-walk fall-through resolves the ~147 HIP-bearing AT-HYG rows
   whose `gaia` column is blank. Both candidates are vetted against a
   G−V magnitude gate (`GAIA_BINDING_G_MINUS_V_REJECT_MAG`, mirroring
   `scripts/binaries/indices.py` — a cross-reference unit test keeps
   the two equal): a bound source >1 mag fainter in G than the row's V
   is a resolvable companion or background star that Gaia's
   best-neighbour match landed on because the bright star itself is
   saturated (Toliman carried a G=20.95 background source, Castor
   carried Castor B's). Rejected rows ship `gaia_source_id = 0` and
   route direction through the HIP2 tiers; counted
   `gaiaBindingMagRejected`.
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
7. **Spectral classification** (`resolveSpectralInfo`; Sol special-cased
   to curated G2V in `stars-parse.ts` — no HIP/Gaia/SIMBAD key reaches
   it). See § Physical radius and spectral parsing.
8. **Physical radius** (`physicalRadius`). Stefan-Boltzmann from absmag
   and the resolved Teff — the measured Apsis Teff (gspphot → gspspec
   via `resolveApsisTeff`, 2–60 kK sanity window) when present, else
   the class-table value; BC always class-table. White dwarfs
   special-cased to 0.013 R☉; Wolf-Rayets keep their own ramps (Apsis
   models neither). Clamped to [0.08, 2500] R☉.

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
vector to the `CATALOG_SCENE_EPOCH` (J2016.0) linearly along the local
east/north tangent basis and renormalises — exact in cos δ, stable
through the poles, <0.002″ error at Barnard's-scale PM over the 24.75-yr
HIP2 J1991.25→J2016 interval. Gaia rows are native J2016.0 → a zero-Δt
no-op. Radial velocity (perspective acceleration) is deliberately
omitted; the full tuple belongs to future current-epoch propagation.
μ_α* inputs are the cos δ-applied rates straight from Gaia/HIP2 — never
divide by cos δ.

Missing source files degrade tiers gracefully (empty map → cascade
falls through), and the per-route build-counts pins
(`directionGaia5p` … `directionAthygPrinted`) flag the drift.

The sky-position regression corpus (`sky-position-corpus.tsv` +
`sky-position.test.ts`) pins the canonical high-PM set (Barnard's,
Kapteyn's, Groombridge 1830, 61 Cyg A/B, Keid) plus one row per
non-Gaia tier (Sirius + Vega for hip2_saturated, ξ UMa for
athyg_printed) against their **J2016.0** positions (the scene epoch).
At J2016.0 the Gaia tier is a zero-Δt no-op, so those rows are a
placement / tier-routing pin — a wrong source or xyz-assembly sign
shows up as tens of arcsec. The propagation formula itself (PM sign /
cos δ / Δt-direction) is exercised by the 24.75-yr HIP2 tier and pinned
independently against SIMBAD J2000 in `direction-cascade.test.ts`.

## Space-motion velocity

Each record carries a space-motion velocity (`vx/vy/vz`, pc/yr, equatorial
Cartesian) alongside its J2016.0 position. Positions stay at the fixed
scene epoch on disk; the runtime epoch-advance pass
(`src/client/loaders/epoch-advance-pure.ts`) reads these once at load to
propagate every position to `getT()`. Full design: SCIENCE.md
§ Current-epoch star positions.

`velocityPcPerYr` (`direction-cascade.ts`) assembles
`v = v_r·û + d·MAS_TO_RAD·(μ_α*·ê + μ_δ·n̂)` from the SAME tier solution
`resolveDirection` selected (`DirectionResolution.src*` fields), so
position and velocity always come from one astrometric solution. The
east/north tangent basis is the shared `equatorialTangentBasis` helper
`directionAtEpoch` also uses. μ_α* is cos δ-applied — never divide by cos δ.

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
visual-doubles flagging (`visual-doubles.ts`), and the 96-byte v8
record write per star including the seven `float32` Apsis fields, the
`uint32` `sid`, plus the three `float32` velocity components. See sections
below.

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

## Binary catalog format (`public/catalog.bin.<i>` + manifest)

Fixed-size records, sorted brightest-first by `absmag`. Current version is
**v8** with a 96-byte stride. Magic and version step together
(v3=`HYG3`, v4=`HYG4`, v5=`HYG5`, v6=`HYG6`, v7=`HYG7`, v8=`HYG8`). v8 appended
three `float32` space-motion velocity components (`vx/vy/vz`, pc/yr) at bytes
84–95 — see § Space-motion velocity. v7 appended a `uint32` `sid` (Stellata ID)
at byte 80 — see § SID allocation. v5 appended a `uint64` Gaia
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
  - 0–3   ASCII `HYG8`
  - 4–7   `uint32` version (currently 8)
  - 8–11  `uint32` count
  - 12–15 `uint32` nameTableOffset
  - 16–19 `uint32` nameTableLength
  - 20–31 reserved
- Record (96 bytes per star)
  - 0–11  `float32 × 3`  x, y, z in parsecs (equatorial, Sol at origin)
  - 12–15 `float32`      absmag — **intrinsic** (de-extincted). The build
                          subtracts the Sol→star Edenhofer A_V so the runtime
                          raymarch re-adds it without double-counting (see
                          § Build-time de-extinction).
  - 16–19 `float32`      ci (intrinsic B–V colour index, de-reddened by the
                          same integral; default 0.65 for missing)
  - 20–23 `float32`      physicalRadius in solar radii (computed at build time)
  - 24–27 `uint32`       companionIdx (record index of binary companion; `0xFFFFFFFF` = none)
  - 28–31 `uint32`       nameOffset (into name table, valid when flag bit 0 set; `0` = none)
  - 32    `uint8`        spectClass (0=O 1=B 2=A 3=F 4=G 5=K 6=M 7=C/S/W 8=?)
  - 33    `uint8`        luminosityClass (0=VII/D … 9=Ia+/0, 255=unknown — see below)
  - 34    `uint8`        constellation index (0–87 into `constellations.json`; 255=none)
  - 35    `uint8`        flags (bit 0=has_name, 1=is_sol, 2=has_bayer, 4=is_binary_primary)
  - 36    `uint8`        **variability amplitude** in 0.05 mag units (0 = not variable)
  - 37    `uint8`        **variability type** (`VAR_TYPE_*`: 0=unknown,
                          1=pulsating, 2=eclipsing, 3=other). Every
                          `VAR_TYPE_ECLIPSING` record also gets
                          `FLAG_BINARY_PRIMARY` (chart-mode wings) and is
                          suppressed from cosmetic runtime pulsation —
                          eclipsers are extrinsically variable, so they
                          surface as multi-star systems, never intrinsic
                          variables (both gates read this byte alone, not
                          `binaries.bin`).
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
  - 80–83 `uint32`       **sid** — Stellata ID (docs/sid.md § 7), the frozen
                          per-object wire identity. `0` (`NO_SID`) only in the
                          unallocated-bootstrap path (§ SID allocation) before
                          the build hard-fails. Every shipped record is
                          nonzero.
  - 84–87 `float32`      **vx** — space-motion velocity x (pc/yr, equatorial
                          Cartesian, Sol at origin). See § Space-motion velocity.
  - 88–91 `float32`      **vy** — space-motion velocity y (pc/yr).
  - 92–95 `float32`      **vz** — space-motion velocity z (pc/yr).
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

### On-disk transport chunking

Cloudflare Workers rejects any single static asset > 25 MiB, and the
assembled v6 binary is ~26 MiB, so it is **not** written as one file.
The build slices the assembled buffer into sequential byte-range chunks
(`public/catalog.bin.0`, `.1`, …), each ≤ `CATALOG_CHUNK_TARGET_BYTES`
(16 MiB, headroom under the limit), plus `public/catalog-manifest.json`
carrying `{ chunkBytes[], totalBytes }`. The split is **transport-only**
— the record layout above is untouched, and `assembleCatalogChunks`
reconstructs the source buffer byte-for-byte.

The chunk-plan / filename / assembly helpers (`planCatalogChunks`,
`catalogChunkFilename`, `assembleCatalogChunks`, `CatalogManifest`) live
in `catalog-pure.ts` and are the single reassembly contract shared by
all three consumers: the writer (`build-catalog.ts`), the runtime loader
(`src/client/loaders/catalog-loader.ts`, fetch), and the Node test/verify
reader (`catalog-lookup.ts` `readCatalogBuffer`, fs). The build removes a
prior run's chunks first so a shrunk chunk count can't strand stale
files, and `isUpToDate` / all Node consumers key off the manifest, not a
monolithic `catalog.bin`. Byte-identical reassembly is pinned in
`src/client/loaders/catalog-loader.test.ts`.

The build script also asserts every headline count (record count, GCVS
xrefs, binary inference output, CCDM doubles, name-table entries,
search-index entries, etc.) against
`scripts/catalog/build-catalog-expected.json` at the end of each run. A
deliberate change refreshes the manifest with
`UPDATE_BUILD_COUNTS=1 npm run build:catalog`; an unintended drift
exits non-zero with a per-key diff. `scripts/catalog/build-counts.ts` carries
the pure comparator + formatter and has its own vitest coverage.
`UPDATE_BUILD_COUNTS=1` / `UPDATE_DISTANCE_OUTLIERS=1` force a rebuild even
when the sources are unchanged, so an up-to-date tree can still refresh a
snapshot.

## SID allocation

Each record's `sid` (byte 80) is its frozen Stellata ID resolved from the
committed ledger (`data/sid/`, docs/sid.md). The build is a pure
**consumer**: `starDesignations` (in `scripts/sid/sid-pure.ts` — the same
extractor `sid:allocate` uses, so both derive an identical class per record)
builds each record's designation set, and `resolveSids` maps it to the
existing ledger sid. The build **never mints** — `sid:allocate` is the sole
ledger writer (docs/sid.md § 4.4).

Bootstrap when the record set changes (new AT-HYG rows, new companions):

1. `npm run build:catalog` resolves every record. Any object absent from the
   ledger is written with `NO_SID` (0) so the artifact still lands, then the
   build **hard-fails** listing the unallocated records.
2. `npm run sid:allocate` reads that catalog.bin + search-index +
   row-index-map, mints the missing sids (an explicit, reviewable
   `ledger.tsv` diff), and rewrites `ledger-head.json`.
3. `npm run build:catalog` again — now every record resolves and the build
   succeeds (it logs `SID: <n> / <n> records resolved`; any shortfall is a
   hard fail, never a shipped artifact).

The runtime reader (`catalog-loader.ts`) decodes the column into
`Catalog.sid`, the star domain of the runtime SID resolver
(`src/client/util/sid-resolver/README.md`); the Node reader
(`catalog-lookup.ts`) inherits the field off `RECORD_LAYOUT` without
decoding it.

## Search index (`public/search-index.json`)

Separate from `catalog.bin` so the main binary stays rendering-focused.
One JSON array entry per star that has at least one searchable identifier
(proper name, Bayer, Flamsteed, GCVS designation, HIP, HD, HR, or Gliese).
Short keys (`i/p/b/f/g/hip/hd/hr/gl/c/s/cl/cp`) to keep wire size down — file is
~15 MB raw, ~4 MB gzipped. Loaded in parallel with `catalog.bin` in
`main.ts`. The `s` field carries the raw spectral designation from the
AT-HYG source ("G2 V", "M1.5Iab-b", "K0III+K7V", …) for the hover tooltip
display. The `g` field carries the GCVS variable-star designation
(`R CrB`, `VY CMa`, `V0645 Cen`) attached during the GCVS cross-match
(§ GCVS variability cross-match) — the lookup key the cross-match already
computes, now also emitted so variables become searchable by their
familiar variable name rather than only HIP/HD. ~14.1k stars are named
(`gcvsNamed`); this is a superset of the ~4.1k with a renderable period
(`gcvsMatched`), because a designation is attached on name-resolution
alone — aperiodic variables (Proxima = V0645 Cen, R CrB, T Tau, novae) are
searchable but never pulsate.

Multiple-star components additionally carry `cl` (canonical WDS component
letter) + `cp` (the system primary's record index), emitted by
`buildComponentDesignations` (`companion-promotion.ts`) after the
row-index map is built — resolving each `multiples.tsv` component through
the same `gaia → hip → synth` priority `build-runtime-binaries.py` uses.
These drive the runtime "<system> <letter>" aliases ("Alpha Centauri C" /
"α Cen C" → Proxima) — see `src/client/typeahead/README.md` § Star
search. The base designation expands from the PRIMARY (`cp`), not the
component's own name: Proxima has no Bayer, and "Rigil Kentaurus C" (the
primary's proper) would be wrong. Coverage is bounded by what decomposes
in `multiples.tsv` (`componentDesignations` in build-counts pins the total).

Field shape pinned in `scripts/catalog/catalog-pure.ts` as the `SearchEntry`
interface — the writer (`build-catalog.ts`) and the reader
(`src/client/search.ts`) both import it; drift = compile error.

Identifier dispatch in `search.ts`:
- Regex-prefix forms (`HIP 27989`, `HD 39801`, `HR 2061`, `Gl 559A`) go
  through `Map<number, number>` direct lookups — no fuzzy scoring.
- Flamsteed (`58 Ori`) also uses a direct `"${num} ${con}"` map.
- Everything else (proper name, Bayer forms, GCVS designations) is
  Fuse-fuzzy.
- For each Bayer'd star, multiple index entries are emitted so any of
  `α Cen` / `Alpha Cen` / `Alp Cen` / `Alf Cen` / `Alpha Centaurus` find
  the star. "Alf" is added only for α (most-commonly alternate-spelled).
- GCVS designations (`g` field) emit an abbreviated + con-name-expanded
  label pair (`V645 Cen` / `V645 Centaurus`); the V-number zero-padding
  GCVS stores (`V0645`) is stripped to the common form (`V645`).

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
to published radii (SCIENCE.md § Physical radius carries the current
per-star numbers; `known-stars.test.ts` pins them end-to-end via the
corpus `primary_radius_rsun` / `primary_ci` columns). Clamped to
`[0.08, 2500]` so pathological catalog rows don't produce absurd
sizes. White dwarfs are special-cased to 0.013 R☉ (typical WD radius;
absmag doesn't translate reliably for them); Wolf-Rayets ride their
own Teff/BC ramps and ignore Apsis.

## Build-time de-extinction

AT-HYG `absmag` is `mag − 5·log₁₀(d/10)` with no de-extinction, so it
embeds the real Sol→star extinction A_V; the ~15% of stars without an
Apsis Teff carry the observed (reddened) B−V in `ci` too. The runtime
shader (`star.vert.glsl`) then raymarches the camera→star A_V and adds
it on top — so with the camera at Sol a dusty-sightline star used to
render ≈2·A_V too faint (and tier-3 colours double-reddened): extinction
counted once in the data and once in the raymarch.

The fix de-extincts at build time against **the same encoded dust the
shader raymarches**: `absmag' = absmag − A_map(Sol→star)` and
`ci' = ci − A_map/R_V`, where `A_map` is a converged Sol→star integral
through the Edenhofer voxel grid. Because the source is the same model
the runtime re-adds, at camera=Sol the build subtraction and the runtime
addition cancel identically for every star — map calibration, cube
truncation at 1.25 kpc, and the `avPerDensityPerPc` conversion all cancel
by construction — so rendered `appMag` reproduces the AT-HYG observed
magnitude (the only at-Sol residual is the shader's 48-step quadrature vs
the build's converged integral). Camera-anywhere: from within the cube,
vantages get physically consistent re-lighting.

- `dust-deextinction-pure.ts` — the pure integral + trilinear sampler
  mirroring the GPU decode (`sampleDensityAt`, `avSolToStar`) and the
  shared `R_V`. `dust-deextinction.ts` — `loadDustGrid` assembles
  `data/dust/` (manifest + 64 chunks) into one flat grid; decode
  constants come from the manifest, never redefined.
- Runs inside `readStars` after the distance overrides settle final xyz,
  **before** `physicalRadius` (radii size off the de-extincted, brighter
  absmag — hence the count re-pin) and before companion promotion.
- Promoted companions de-extinct along their own sightline in
  `companion-promotion.ts`, except where the value is already intrinsic:
  a spectral-derived absmag (class→M_V) and a derived ci (Ballesteros /
  solar fallback) are left untouched; observed-photometry absmag and the
  row's own observed ci get the subtraction.
- **Dust data absent at build → HARD FAIL** (`loadDustGrid` throws). The
  Bailer-Jones soft-continue precedent does not apply: a soft-continue
  would ship extincted absmags into a runtime that assumes de-extincted,
  silently reintroducing the double-count.
- Beyond the 1.25 kpc cube the runtime raymarch adds ≈0, so distant
  dusty sightlines stay single-counted (extinction embedded in absmag,
  still exact from Sol) until the raymarch stack is extended.

**Invariant:** the build-time de-extinction integral and the runtime
extinction stack must model the same dust (same maps + slab). Any
runtime-stack change ships with the mirrored build-side integral
extension + a catalog rebuild in the same release. Apsis `azero_gspphot`
(offset 64–67) is a validation cross-check only, never the de-extinction
source — a different estimator than the raymarch would leave a Sol
residual.

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

Before promotion runs, `backfillPrimaryIdentifiers` (same module)
sweeps the pair-primary rows and backfills HIP + Gaia source_id onto
identifier-less catalog records, joined by the TSV's `hd` column —
never by position: the nearest-position record to ξ UMa A is ξ UMa
B's, so a position join would stamp A's identifiers onto B. This is
what makes HD-only AT-HYG systems addressable by `lookupByHip` /
URL refs. Guards: unique HD in the catalog, target record carries no
id of its own, no id duplicated from another record. Counted
`multiplesIdentifierBackfill`.

`companion-promotion.ts` runs BEFORE the absmag sort. It reads the
binaries pipeline output and adds first-class catalog records for
the secondary of every physical pair whose identifier isn't already
in AT-HYG. ~14.2k companions promoted into the current build
(Sirius B, Achird B, Porrima B, Fomalhaut C, Algol Ab, …) — about
a third via real Gaia/HIP keys, two-thirds via synthetic identifiers
(see the identifier gate below).

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
  pairs (WDS ρ 0.000, or a null sep/pa where WDS reported no
  measurement) have no static placement
  to bake: with a renderable orbit the secondary collocates
  BIT-IDENTICALLY on the anchor — a placement choice for the LOD
  fallback, not a runtime signal. The runtime renders the relative
  offset as R(t) from the orbital elements alone regardless of the
  baked placement (`src/client/binaries/orbit-relation-cache.ts`
  `baseDiffPc`) — and without a placement the row drops
  (droppedNoPosition): nothing would ever separate the records and
  the collocated star double-counts the blend photometry.
- **Projected-separation tidal gate.** A tangent-projected secondary
  sits at the primary's distance, so its projected physical separation
  `ρ·d` is a lower bound on the pair's true 3D separation. When that
  exceeds `OPTICAL_DOUBLE_MIN_SEP_PC = 1.0` pc (the Galactic
  tidal-disruption limit, the same constant the CCDM optical-double
  suppression and the binaries pipeline's Stage-5 `SEPARATION_LIMIT_PC`
  use) no pair can be bound, so the projection is refused
  (droppedBeyondTidalLimit) rather than fabricating a companion at a
  bogus placement. This catches wide line-of-sight optical doubles whose
  secondary has no parallax for Stage 5 to reject — e.g. SHY 476 BC
  (05359+3530), a foreground star 999.5″ from a ~1470 pc primary. Only
  the projection branch consults it; a secondary with its own resolved
  astrometry is vetted upstream by Stage 5.
- **Inner-pair re-homing (post-pass).** An inner pair's cursor primary
  (Castor Ba) can carry the system's blended identifier — a shared Gaia
  source, or a shared HIP Gaia later split — so it resolves onto a
  sibling (Castor A) and the secondary bakes there instead of on its true
  parent component (B). A post-pass re-runs the placement against the
  parent's resolved slot (synth record first, then a per-system
  component→index map for a parent that kept its own Gaia row), covering
  both the ρ=0 collocation and a measured sep+PA re-projection. This makes
  the baked placement match the runtime pair anchor
  (`build-runtime-binaries.py`'s `override_inner_primary_indices`);
  counted by `repositionedInnerToParent`. Rendering is unaffected either
  way (elements-alone R(t)), but a consistent bake keeps the
  baked-vs-elements ratchet in `multi-star-regression.test.ts` honest.
- **Position for pair-row primaries.** When the cursor primary itself
  needs promotion (40 Eri B — primary in BC/BD/BE, never a secondary
  of A), position resolves in preference order: (1) the row's own
  per-component astrometry when Stage 3 supplied a real independent fit
  (own `gaia_5p` / `hip2_long_baseline` whose id differs from the
  anchor's); (2) project the row's Stage-6 `anchor_sep_arcsec` /
  `anchor_pa_deg` off the WDS-root anchor star — the per-component
  offset BFS-composed over kept, Stage-5-rejected, and
  compound-photocentre pair geometry (40 Eri B lands at the A,BC
  compound proxy; Acrux B at the rejected AB row's 3.5″/114°).
  Neither available → **drop** (`droppedCollocatedPrimary`). Collocating
  on the anchor would bake a false coincident star inside the anchor's
  disc (δ Vel C): the escape only fires for cursor primaries that never
  appear as a secondary of the anchor, so no anchor→self orbital pair
  exists for `BinaryOrbitField` to animate it away from centre at
  runtime.
- **Blended-identifier escape.** The pair-row-primary escape fires not
  only when the cursor primary resolves to nothing, but also when it
  resolves to the WDS-ROOT ANCHOR's record while its comp is a DISJOINT
  top-level letter — Acrux B carries A's shared HIP, omicron And B
  carries A's shared Gaia source, and a disjoint letter cannot BE the
  anchor. The letter's true slot is its own synth record (a sibling
  cursor's mint is reused); with no honest placement the cursor falls
  back to the blended anchor hit, exactly the pre-escape behaviour.
  Sub-letter primaries (Castor Ca) are excluded — the inner-pair
  post-pass and the writer's parent override own that re-homing. The
  Gaia inheritance gate mirrors the HIP gate's anchor-STAR check for
  the same shape: propagation can bind the shared source to a row
  whose anchor-row cell is empty.
- **Absmag.** Preference order: `primary_absmag + WDS Δmag` when the
  row inherited its parent's AT-HYG photometry (Sirius B's row
  carried Sirius A's 1.45 absmag, not the WD's 11.36); the row's own
  (non-inherited) absmag — including the Stage-6 Gaia-photometry value
  (`photometry_via = gaia_photometry`) derived from an own-DR3
  companion's G/BP/RP + parallax when no AT-HYG row backs it (SCIENCE.md
  § Multiple-star pipeline); primary + Δmag fallback; the row's own WDS
  apparent magnitude at the system distance (`wds_mag`, M = m −
  5·log₁₀(d/10) — fires when both Δmag paths are unavailable and
  rescues rows that previously dropped for want of a brightness);
  class→M_V from a per-component spectral type (`absmagFromSpectral`,
  spect_via curated/simbad — Algol Aa2's curated K0IV lands at 3.30 vs
  the primary's −0.11). A row with none of those has NO honest
  brightness source: returning the inherited value minted
  full-luminosity twins (Betelgeuse Ab). Those rows drop — unless the
  pair carries a renderable orbit binaries.bin must keep addressing,
  where the twin is kept and counted
  (`companionAbsmagInheritedTwinOrbital`, a ratchet-down
  metric: curate types to shrink it). For a **pair-row-primary
  escape** the row's Δmag describes the sub-pair it heads, not the
  anchor→row separation (40 Eri B's Δmag is the B→C delta), so both
  `primary + Δmag` paths are suppressed; and when the escape row's
  only ids were inherited from the anchor its "own" AT-HYG photometry
  is the anchor's BLEND magnitude, so the own path is skipped too
  (Acrux B takes its WDS V=1.55, not the −4.2 blend). Absent any
  honest brightness the record inherits the anchor's collocated
  brightness (`companionAbsmagAnchorCollocated`) rather than a
  corrupted A+Δmag.
- **Anchor flux conservation (post-pass).** A member whose light is
  embedded in an `athyg_own` anchor's AT-HYG magnitude double-counts
  the flux if minted without dimming the anchor. Blend membership is
  structural for a synth member whose ids were inherited-then-stripped
  from the anchor; a member carrying its own distinct identifier
  (Castor B under its own Gaia source) qualifies only when the
  anchor's observed apparent magnitude reads as the WDS pair's
  combined mag_pri+mag_sec light rather than mag_pri alone
  (`anchorMagIsPairBlend` — Hipparcos/Tycho blend close pairs, Castor's
  1.58 = A+B, but resolve wide ones, Polaris' 1.98 = A alone).
  Identifier-less synth members (Polaris Ab) are excluded from that
  test: several can share one anchor whose magnitude blends only SOME
  members, and the pairwise hypothesis test misattributes (36 Oph D
  would claim A+B's blend); a system-level flux solve is future work.
  Two shapes:
  a `dmag_imputed` member re-splits the blend JOINTLY by Δmag
  (`M_A = M_blend + 2.5·log₁₀(1 + 10^(−0.4Δ))`, `M_B = M_A + Δ` —
  exact conservation for any Δ; a naive flux subtraction would gut a
  near-equal anchor, Capella −0.51 → +2.1, because `M_blend + Δ`
  overstates the member); a `wds_mag` member's independent brightness
  is subtracted directly, guarded against a member as bright as the
  blend itself (`blendDimSkipped`). Sequential per anchor; counted
  `blendDimmedAnchors`. The equal-split gaia_photometry blend pass
  above stays for the N-way no-WDS-mag case.
- **Blend split (post-pass).** A sub-arcsec pair Gaia fit as a single
  5p source with neither component in AT-HYG (YY Gem = Castor Ca,Cb)
  surfaces as ≥2 collocated `gaia_photometry` records — the outer-pair
  row for the source and the inner pair's components — each carrying the
  source's COMBINED `M_V`, so the system renders ~2× too bright. After
  the cursor walk, records are grouped by their backing Gaia source
  (`row.gaiaSourceId`, pre-inherited-id-strip, so an inherited-Gaia synth
  secondary still groups with its blend partner); a source backing N≥2
  gets each record dimmed by `2.5·log₁₀(N)` (0.753 mag for a pair) and
  its radius re-derived. Equal split — a pair Gaia couldn't resolve is
  near-equal by construction, exact for the M-dwarf eclipsing pairs that
  dominate; total system light is preserved. `ci` stays the shared
  colour. Counted `companionBlendSplit`; runs before the absmag sort.
  See SCIENCE.md § Multiple-star pipeline (Blend split).
- **B-V (ci).** When Stage 6 tags the row's photometry as inherited
  (`photometry_via = athyg_system_inherited`), recompute from the
  spectral info via `tempKelvin → ballesterosBvFromTeff`. Sirius B's
  DA1.9 stores ci = -0.443 (deep blue at the LUT) rather than the
  inherited 0.009 white.
- **Spectral / lum class.** From `classifyFromSimbad(row.spect)` when
  the row's `spect_via` is per-component (curated / simbad — DA1.9 for
  Sirius B, K7Ve for Achird B). When the string is the system
  primary's inherited AT-HYG type (`spect_via=athyg`) or blank AND the
  member's absmag came from an own-brightness source (dmag-imputed /
  own / wds_mag), the type is instead a main-sequence estimate from
  the member's own de-extincted M_V (`spectralFromAbsmag`, the inverse
  of the class→M_V calibration; lumClass V). Wearing the primary's
  type made a fainter companion hot-but-tiny — Stefan-Boltzmann turns
  a hot inherited Teff on a faint absmag into a spuriously small
  radius AND a blue colour (Algol Ab rendered as a tiny B8V; Acrab B
  inherited B0.5V at 7.98 mag fainter). The MS estimate is wrong for
  evolved companions but strictly less wrong than the primary's type;
  curated overrides / SIMBAD per-component types take precedence, and
  no `spectDisplay` is claimed for the estimate. Counted
  `companionSpectMsFromOwnAbsmag` (~12.6k of 14.2k promoted). Rows
  with neither fall back to `SPECTRAL_UNKNOWN`.
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
  AT-HYG entry of its own. Two doubling guards strip an already-present
  component letter so the canonical comp isn't appended twice:
  `stripDoubledParentToken` for a base ending in the comp's parent /
  local-primary letter (Castor "C" + "Cb" → "Castor Cb"; AR Cas
  "HIP 115990 F" + "G" → "HIP 115990 G"), and `stripBlendedSiblingLetter`
  when a blended top-level component inherited a SIBLING's composed name
  — Acrab's WDS E shares β² Sco's (WDS C) Gaia source, so E's row name is
  "Acrab B"; a top-level letter composes flat off the system base, so
  "Acrab B" + "E" strips to "Acrab E", not "Acrab B E".

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

#### Promoted-companion field inheritance

Every field of a minted companion record is one of: **inherited**
from the anchor primary (system-level property), **system-derived**
(computed from the anchor plus the WDS geometry), **per-component**
(the measurement that justified promoting the row), or **post-pass /
unset** (filled later or never). The derivation prose above is
per-field detail; this is the whole-record contract.

"Anchor" here means the local anchor primary, or the WDS-root system
primary when the local anchor never made it into the catalog (δ Vel CD
class). Both inherited fields below resolve that same anchor, so a
companion never gets one without the other.

| Field(s) | Origin | Source |
| --- | --- | --- |
| `conIndex` | inherited | anchor's index — constellations ship no boundary polygons, so a position can't be classified. Rows whose anchor is absent or itself unclassified keep `NO_CONSTELLATION_INDEX`. Counted `companionConstellationInherited`. |
| `vx/vy/vz` | inherited | anchor's systemic velocity — a static companion shears off the primary under the epoch-advance otherwise (§ Space-motion velocity, Pair coherence). Truly anchor-less escapes fall back to zero. |
| `x/y/z` | system-derived | anchor ICRS position + WDS (ρ, θ) tangent projection at the anchor's distance. |
| `proper` | system-derived | `<primary_proper> <comp>` (own `name` cell wins when present). |
| `hip`, `gaiaSourceId` | per-component | the row's own id — stripped to `null` (→ `synth-<wds_id>-<comp>`) when it equals the anchor's shared id, per the inheritance gates above. |
| `absmag` | per-component | Stage-5 decomposition / dmag / blend split. |
| `ci` | per-component | own observed B–V, else Ballesteros from the resolved spectral type. |
| `spectClass`, `lumClass`, `spectDisplay` | per-component | SIMBAD/curated type, else a main-sequence estimate from the own M_V. |
| `physicalRadius` | per-component | Stefan-Boltzmann from the per-component absmag + Teff. |
| `flags` | per-component | `FLAG_BINARY_COMPANION_ONLY` (+ `_SYNTHETIC`). |
| `syntheticId` | per-component | `synth-<wds_id>-<comp>` when no own id survives the gates. |
| `companionIdx` | post-pass | set by geometric binary inference (§ Geometric binary inference). |
| `period`, `amplitude`, `varType`, `gcvsName` | unset | companion variability isn't tracked at promotion. |
| `hd`, `hr`, `flam`, `bayer`, `gl` | unset | not carried on multiples.tsv rows. |

Position and constellation both flow from the anchor because a
promoted companion sits sub-arcsec off it — well below the catalog's
positional precision — so the pair shares one sky patch. The
per-component fields are precisely the ones the promotion exists to
surface: the companion is a distinct row because its brightness,
colour, and type differ from the blended primary.

### Renderable-companion wings

The three passes below that set `FLAG_BINARY_PRIMARY` (the chart-mode
wings bit) — geometric `inferBinaries`, the CCDM pass, the eclipsing
sweep — are all keyed on evidence that is unaligned with the
*presence of a rendered companion*. A physical pair wider than the
`0.005 pc` geometric cell, not CCDM `C/G/O`, and not eclipsing
(16 Cyg A, whose promoted placement exceeds the geometric cell) shows a
companion or a live orbit with no wings on the anchor.
`wingRenderablePrimaries` (run after those three passes, over the
post-sort `buildCatalogRowIndexMap`) closes that gap:

- **Renders-a-companion gate.** For each non-standalone
  multiples.tsv pair, primary and secondary resolve to catalog records
  through the same `gaia → hip → synth` priority
  `build-runtime-binaries.py`'s `resolve_idx` uses, plus both of that
  writer's blended-sibling synth retries: each pair end re-homes onto
  its own distinct synth slot whenever promotion minted one (a synth
  slot exists only for rows whose ids were inherited then stripped,
  so it is always the truer target — Castor Ca inside the outer pair,
  04049-3527's pair-mate-inherited C). A pair whose two sides resolve
  to DISTINCT records
  renders a companion, so the winged set tracks `binaries.bin`'s
  primaries. The writer's post-resolution steps
  (`override_inner_primary_indices`, the relation-winner dedup) are not
  replicated: they change *which* index anchors a pair, never the
  distinct-pair boolean this gate keys on, and root-grouping plus the
  brightest-participant pick below absorb the difference. The
  correspondence is pinned against the real `binaries.bin` by
  `multi-star-regression.test.ts` (every rendered system carries the
  wings bit), which catches drift on either side.
- **One glyph per WDS system.** Records participating in a rendered
  pair are grouped by WDS root; the bit lands on the brightest
  participant only (the mutual-primary / CCDM brightest-member
  contract). A hierarchical system (Castor Ca,Cb inside the outer
  pairs) gets one glyph on the system anchor, never one per inner
  pair. A system any earlier pass already flagged is skipped, so it
  keeps its single glyph.
- **Additive only.** The pass never clears wings, so the
  reverse-direction cases stay correct: eclipsing binaries (an
  eclipsed star is a binary by convention even with a
  spectroscopically-unresolved companion) and iconic CCDM / Hipparcos
  doubles whose faint secondary isn't in the classic-IDs catalog
  (ν³ CMa = HDS 915, the Sirius-B pattern) keep their wings whether or
  not a second star renders.

`renderableCompanionWinged` in build-counts pins the count.

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
resolves a GCVS name (gaia_source_id first, then HIP, then HD), then
looks up the period+amp. Two independent gates:

- **Naming** (search) — the resolved designation is attached as
  `gcvsName` whenever a name resolves (~14.1k stars, `gcvsNamed`). This
  is the `search-index.json` `g` field.
- **Rendering** (pulsation) — period / amplitude / varType apply only
  when the GCVS main table gave that name a parseable period+amplitude
  (~4.1k, `gcvsMatched`). Aperiodic variables — flare stars
  (Proxima = V0645 Cen), RCB (R CrB), irregular (T Tau), novae
  (V1500 Cyg) — are named for search but never pulsate.

Most catalog stars aren't variable, but the ones that are tend to be the
astronomically interesting ones (Betelgeuse, Mira, Algol, Cepheids, etc.).

Each row's `varType` comes from `classifyGcvsVarType` (`catalog-pure.ts`):
GCVS EA/EB/EW/ELL/E → `VAR_TYPE_ECLIPSING`, the pulsator families →
`VAR_TYPE_PULSATING`, everything else → `VAR_TYPE_OTHER`. A bare
transiting-planet host (GCVS EP with no superimposed intrinsic
pulsator, `isPlanetaryTransitOnly`) is dropped from the cross-match
entirely — its dip is extrinsic occlusion by a planet, not the star's
own output, and it is not a stellar multiple, so it earns neither an
intrinsic-variable ring/pulse nor multi-star wings and renders as an
ordinary star. `EP+DSCT` and the like keep the pulsator's ring.
Eclipsing binaries are extrinsically variable, so after the CCDM pass a
sweep ORs `FLAG_BINARY_PRIMARY` (the chart-mode wings bit) onto
every `VAR_TYPE_ECLIPSING` record not already flagged
(`eclipsingWinged` in build-counts); the runtime also suppresses their
cosmetic pulsation by this byte alone. They surface as multi-star
systems, never intrinsic-variable rings. (A fourth wings pass,
`wingRenderablePrimaries`, then covers physical pairs none of these
three reach — see § Companion promotion, Renderable-companion wings.)

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

### Optical-double suppression

CCDM+MultFlag=C/G/O still keeps a tail of wide line-of-sight
optical pairs Gaia can now split in 3D — HIP pairs sharing one
CCDM identifier that sit hundreds of pc apart along the sightline.
Flagging their brightest member paints wings on a star with no
bound companion. `isOpticalDoublePrimary` (`catalog-pure.ts`)
vetoes that flag, but only on **positive** evidence the asserted
pair is optical, never on mere absence of physical evidence — so a
noisy parallax can never strip real wings:

- **Physical-evidence keep.** The picked primary keeps its wings
  when it is a component of a kept physical pair in
  `data/binaries/multiples.tsv` (the binaries pipeline's Stage-5
  optical filter already vetted it as bound — the `physicalHips` /
  `physicalGaia` sets), when it is eclipsing (extrinsic wings
  earned), or when the geometric mutual-pair pass already winged it
  (honoured upstream by `markPrimaryIfUnflagged`'s already-flagged
  short-circuit). The curated `KNOWN_VISUAL_DOUBLES` HIPs are folded
  into `physicalHips` so they are never suppressed. This is the gate
  that keeps η Cas (Achird A, its real A/B pair) and β¹ Cyg
  (Albireo, its resolved Aa/Ac inner pair) winged even though each
  CCDM group also holds a wide optical sibling.
- **Optical suppress.** Otherwise the nearest same-group catalog
  sibling with a Gaia-quality distance is measured in 3D; a
  separation beyond `OPTICAL_DOUBLE_MIN_SEP_PC = 1.0` pc (the
  Galactic tidal-disruption limit, mirroring the binaries
  pipeline's Stage-5 `SEPARATION_LIMIT_PC`) marks it optical and
  drops the wings. Both the primary and the sibling must carry a
  Gaia-quality distance (`isGaiaQualityDist` — same dist_src set as
  B-J eligibility, {G_R3, G_R2} → G_R3/BJ final) for the separation
  to be trusted; absent that, the wings stand. Nearest-sibling means
  a physically-close catalog member keeps the wings regardless of a
  wide background star that merely shares the CCDM string — the
  failure mode that made a naive "3D-separation over full CCDM
  membership" test regress η Cas. Counted `ccdmSuppressedOptical`
  (~487 of the ~11k flagged primaries; median suppressed separation
  ~54 pc).

`parseHipCcdm` returns systems grouped by `CCDM_ID` (real CCDM
strings for file-driven entries, synthetic `OVERRIDE-N` keys for
the `KNOWN_VISUAL_DOUBLES` list). `applyDoublesFlag` then walks
each group, picks the **brightest** catalog member (lowest
`absmag`), and — unless the optical-double gate above vetoes it —
ORs `0x10` onto only that one, so each Hipparcos-resolved system
contributes exactly one chart-mode wings glyph, matching the
geometric pass's mutual-primary semantics. Stars that
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
| `LMC_CENTRE_RA_HOURS` | 5.25067 (= 78.76°) | LMC PM dynamical centre RA (vdM&K 2014). |
| `LMC_CENTRE_DEC_DEG` | −69.19 | LMC PM dynamical centre Dec (vdM&K 2014). |
| `LMC_CONE_HALF_ANGLE_DEG` | 15 | Sky-cone half-angle. |
| `LMC_PM_RA_CENTRE` | 1.85 mas/yr | PM gate centre μ_α* (≈ vdM&K 2014 COM 1.910). |
| `LMC_PM_DEC_CENTRE` | 0.20 mas/yr | PM gate centre μ_δ (≈ vdM&K 2014 COM 0.229). |
| `LMC_PM_TOLERANCE` | 0.5 mas/yr | Per-axis tolerance around the gate centre. |

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

`MAX_DIST_PC = 50_000` (exported from `stars-parse.ts`) drops any row
whose final distance still exceeds 50 kpc after Layers 1 and 2. This
is **not** a noise filter — it's a statement about which populations
the model currently represents (Sol out to and including the LMC).
The cutoff bumps in sync with each new modelled population the
renderer takes responsibility for (future SMC, Sgr dSph, M31
supergiant layers would extend it). See SCIENCE.md § Stellar catalog
ingestion for the framing rationale.

Every kinematic-override target distance must satisfy
`dist < MAX_DIST_PC` or its entire population is silently dropped at
this cut; `catalog-pure.test.ts` pins `LMC_DISTANCE_PC < MAX_DIST_PC`
(406 pc of margin today). A future SMC layer (~62 kpc) must raise the
cutoff in the same change.

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

- **Per-star colour routing.** The shader is two-tier —
  `iTeffApsis > 0 ? Ballesteros(iTeffApsis) : iCi` — so `bestApsisTeff`
  (`star-color-routing-pure.ts`) writes the best Apsis Teff to the
  `iTeffApsis` attribute, and the lower tiers are baked into `iCi` at
  build: an observed AT-HYG B−V, or the intrinsic spectral-class colour
  `spectralClassCi` (`catalog-pure.ts`) derives when a no-Apsis star has
  no B−V but a parseable class (`ciSpectralDerived` in build-counts),
  else the solar fallback.
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
  carries ~80 hand-curated systems (single stars + multiples) with
  expected HIP, Gaia DR3 source_id, distance ± 1σ, absmag, spectral
  type, optional intrinsic-colour + physical-radius pins (primary_ci
  ±0.03 / primary_radius_rsun ±10% or per-row radius_rel_tol — the
  end-to-end guard on the two most user-visible per-star properties),
  per-companion (HIP, source_id, absmag) tuples, and optional
  GCVS variability pins (var_type / var_period_days / var_amp_mag —
  published values quantised through `encodeAmpUnits` /
  `encodePeriodUnits` before comparison; `var_type=none` asserts a
  record is NOT variable). Coverage spans one pin per population
  dimension: nearest M dwarf, halo subdwarf, white dwarfs (single +
  promoted-companion), carbon star, Wolf-Rayet, O supergiant, each
  animated GCVS family (M, DCEP, SRC, EA, EW), LMC members, B-J
  regression cases, a Tycho-only no-HIP record, and the multi-star
  showcase systems (Castor, Algol, AR Cas, ν Sco, 40 Eri).
  `scripts/catalog/known-stars.test.ts` loads `public/catalog.bin` via
  the runtime loader and asserts every row matches within tolerance.
  Adding a row → see § Adding to the known-stars corpus below.
  The sky-position corpus (`sky-position-corpus.tsv` +
  `sky-position.test.ts`, § Direction resolution) is the companion
  Tier A harness for single-star angular placement.
- **Tier A — system pair topology.**
  `scripts/catalog/system-pair-topology.tsv` (driven by the same
  `known-stars.test.ts` harness) pins, per WDS root, the EXACT set of
  pair rows multiples.tsv may emit — a dropped physical pair and a
  re-leaked optical pair both fail by name. This is the regression
  guard on Stage 5 optical-filter verdicts (Sirius AC-AF, Albireo AB,
  40 Eri D/E) and on the showcase systems' sub-pair subdivision
  topology. Rows can additionally pin a minimum 3D separation between
  two catalog records as the on-record Gaia evidence that a rejected
  pair is optical (Albireo A↔B at ~9.4 pc). Standalone `_X` member
  rows are exempt from the exact-set check.
- **Tier A — multi-star geometry corpus.**
  `scripts/catalog/multi-star-regression.tsv` +
  `multi-star-regression.test.ts` pin per-PAIR geometry against
  external truth (WDS sep+PA at the published epoch, ORB6 periods):
  catalog.bin tangential separation + PA between the two component
  records, the multiples.tsv geometry columns, the binaries.bin
  Tier-1 record (flags, elements, stored sep/PA/epoch), and a Kepler
  propagation to each record's own `sep_pa_epoch_jd` through the same
  pure path the runtime baseline cache uses. Also drives the runtime
  render layer against the shipped artifacts: every cached relation's
  offset `baseDiffPc + ΔR(t)` must stay on its orbit shell
  `[a(1−e), a(1+e)]` (the headline sweep — would have caught the
  displaced-centre bug), a full `BinaryOrbitField` walk of Algol Aa,Ab
  in the focus regime, and a ratchet counting non-collocated Tier-1
  pairs whose baked placement disagrees with elements-alone R(epoch)
  by > 0.5·a (a data-curation signal, ratchets DOWN). Also sweeps
  identifier integrity: corpus-wide HIP distinctness, URL star-ref
  round-trips (first-seen `hipToIndex` semantics matching `main.ts`),
  and a pinned-count ratchet on promoted-companion HIP collisions.
  A catalog-wide variability-honesty sweep asserts every
  `VAR_TYPE_ECLIPSING` record carries `FLAG_BINARY_PRIMARY` (eclipsers
  earn wings, never a variable ring), with Algol as the named showcase.
  Column contract + per-row tolerance discipline live in the TSV header.
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
3. For GCVS variables, pin `var_type` (`pulsating` / `eclipsing` /
   `other`) plus the PUBLISHED (unquantised) `var_period_days` and
   `var_amp_mag` (max − min); the test applies the byte encoding
   before comparing. `var_type=none` on a non-variable guards against
   false-positive cross-matches. Use the spectral string the resolver
   actually consumed (`data/simbad/simbad_sptype.tsv`) when SIMBAD's
   live sp_type differs — the corpus pins pipeline behaviour, with the
   live value noted in notes_source.
4. Append the row. Run `npm test -- known-stars` to confirm the row
   passes against the current `public/catalog.bin`. The test parses the
   spectral string via `classifyFromSimbad` so the format must be
   SIMBAD-canonical MK.
5. If the test fails on a row you expected to pass, the discrepancy is
   genuine — either the catalog has a bug or the expected values are
   wrong. Don't relax the tolerance to silence; investigate.
6. When curating a multi-star system, also pin its kept-pair set in
   `system-pair-topology.tsv` — the exact-set fixture is what catches
   a later ingest silently adding or dropping a pair for that root.
