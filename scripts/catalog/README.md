# Catalog build

Single-star catalogue build pipeline: the inherited spine + GCVS + CCDM +
Bailer-Jones + Gaia Apsis + SIMBAD sp_type +
Stellarium → `public/catalog.bin.<i>` transport chunks +
`public/catalog-manifest.json` + `public/constellations.json` +
`public/search-index.json` + `public/catalog-row-index-map.json` +
`public/constellation-boundaries.json`.
Run via `pnpm run build:catalog`.

Membership is `data/athyg/inherited-spine.tsv` and nothing else — AT-HYG the
catalogue left this build's input set. Classic designations are the frozen-CDS
overlay merged onto the spine's inherited cells (`classic-ids/README.md`). The
contract is `docs/catalog-driver.md`; the membership term is
`spine/README.md`.

This file owns the **output contract**: the on-disk record layout, SID
allocation, the search index, and the Apsis surfacing. The per-stage work
lives in the subfolders.

## Subfolders

- `astrometry-request/` — the Gaia 5p pull's source_id list: the spine
  column plus the classic-ID gate's candidates. Input preparation for
  `scripts/refresh/`, not on the `build:catalog` path.
- `parse/` — the per-row pipeline (`readStars`), reference-catalogue
  parsers, space-motion velocity, and Stellarium stick figures. Its
  `gcvs/` subfolder owns the variable-star parsing and the variability
  cross-match.
- `spectral/` — Morgan-Keenan parsing of SIMBAD `sp_type`, the seven-tier
  spectral resolver, and the Stefan-Boltzmann radius chain. Imports the
  namespace ladder from `catalog-pure.ts`; nothing there imports back.
- `boundaries/` — `public/constellation-boundaries.json`: the IAU boundary
  arcs resampled and precessed to ICRS, the per-region label anchors, the
  resolved cell grid the runtime resolves membership against, and the
  magnitude-keyed fade-quantile table the chart-mode layer derives its
  fade window from.
- `companions/` — promotion of `data/binaries/multiples.tsv` secondaries
  into first-class catalog records. Its `record-index/` subfolder holds
  everything that addresses records *after* the absmag sort: the row-index
  sidecar, the renderable-companion wings bit, and the component-letter
  designations the display-name composer builds on.
- `naming/` — the IAU WGSN authority ladder end to end: ingest, the
  designation normalisers, the record-side join, and the one pure composer
  the build and the runtime both render display names with.
- `multiplicity/` — multiplicity status, geometric binary inference, the
  CCDM double-star cross-match with its optical-double suppression
  cascade, and system distance coherence.
- `distance/` — direction resolution, build-time de-extinction, and the
  multi-layer distance-refinement override stack with its authoring
  discipline and post-build regression check. Its `radial-velocity/` and
  `pm-rescue/` subfolders own the velocity's two fall-back cascades.
- `photometry/` — the published Gaia broadband relations and the two
  cascades over them: Johnson V, and the B−V colour index.
- `classic-ids/` — the frozen-CDS overlay build
  (`pnpm run build:classic-ids` → `data/classic-ids/`) AND the record build's
  label layer: the per-identifier merge with its collision guard, plus the
  designation-constellation cascade. Applied as a post-pass over `readStars`.
- `spine/` — the membership term: the frozen
  `data/athyg/inherited-spine.tsv`, its codec, and the two gates holding it
  to the build it snapshots. `parse/` streams it through `iterSpineTsv`.
- `membership/` — the primaries-derived membership manifest
  (`pnpm run build:membership` → `data/membership/`) and its replacement
  parity gate. `readStars` switches onto it in `stellata-3bsf.8.3`.
- `validate/` — the Tier-A/B validation harness, `verify-catalog`, the
  SIMBAD-sample cross-check, and the frozen regression corpora.

## Files in this area

```
scripts/catalog/
  build-catalog.ts                Orchestrator. Reads every reference
                                  catalogue, runs the per-row pipeline and
                                  each cross-match pass in order, then
                                  writes the chunked binary + manifests.
  catalog-pure.ts (+ test)        Single source of truth for the v9 binary
                                  layout, override math, and the SIMBAD
                                  namespace ladder (`SimbadNamespaceIndex`,
                                  `indexSimbadRow`, `walkSimbadNamespaces`,
                                  `normaliseGjKey`, `simbadHipKey`) that both
                                  SIMBAD pulls index and join through. Pure;
                                  imported by every subfolder and by
                                  src/client/loaders/. Holds no spectral
                                  symbol — that is `spectral/`, one-way.
  cited-proper-motion.ts (+ test) `CitedProperMotion` and `CitedParallax`,
  cited-parallax.ts               with their only constructors: a value is
                                  admitted only with the bibcode that sourced
                                  it, so an uncited one is unrepresentable.
  simbad-values-parse.ts (+ test) data/simbad/simbad_values.tsv indexed by
                                  every namespace the pull keyed on, over the
                                  shared ladder in catalog-pure.ts. Bottom
                                  tier of the rv, direction/PM and distance
                                  cascades alike.
  tycho2-parse.ts (+ test)        data/tycho2/ indexed on the full TYC, with
                                  the position-to-propagate-from choice and
                                  the main-table-wins rule resolved at parse
                                  time (data/tycho2/README.md). Feeds the
                                  direction, PM-rescue and V cascades.
  gliese-parse.ts (+ test)        data/gliese/ keyed on the bare Gliese
                                  number + component, so the catalogue's four
                                  name prefixes and a record's `gl` cell meet
                                  (data/gliese/README.md). Bottom tier of the
                                  V cascade, trigonometric tier of parallax.
  catalog-lookup.ts (+ test)      Reads a built catalog back (loadCatalog) — the
                                  shared reader for verify-catalog, the frozen
                                  corpora, validate-simbad-sample, sid:allocate.
                                  A `name:` record ref resolves through the
                                  name table AND the composed display labels,
                                  so a corpus row may name a star by the
                                  designation it displays (`naming/README.md`).
  build-counts.ts (+ test)        Per-strategy / per-tier count snapshot
                                  comparator, pinned by
                                  build-catalog-expected.json. Generic over
                                  the count record — classic-ids/ pins its
                                  own snapshot through the same helper.
```

## Binary catalog format (`public/catalog.bin.<i>` + manifest)

Fixed-size records, sorted brightest-first by `absmag`. Current version is
**v9** with a 100-byte stride. Magic and version step together
(v3=`HYG3` … v8=`HYG8`, v9=`HYG9`). v9 appended a `uint8`
`multiplicity_status` at byte 96 (bytes 97–99 reserved, zero-filled, so
the stride stays a multiple of 4) — see `multiplicity/README.md` § Multiplicity status. v8
appended three `float32` space-motion velocity components (`vx/vy/vz`,
pc/yr) at bytes 84–95 — see `parse/README.md` § Space-motion velocity. v7 appended a `uint32` `sid` (Stellata ID)
at byte 80 — see § SID allocation. v5 appended a `uint64` Gaia
DR3 `source_id` at bytes 44–51 so downstream cross-match (GCVS, CCDM,
NSS, Apsis) can anchor on the same Gaia ID Stellata's source-ID-anchored
pipeline uses everywhere else; ~99.6% of records carry one (the residual
~0.4% are the famous bright binaries Gaia couldn't fit a 5p PM to). v6
appended seven `float32` Gaia DR3 Apsis astrophysical parameters at
bytes 52–79 (gspphot Teff/logg/[M/H]/A0 then gspspec Teff/logg/[M/H]),
keyed by the v5 `gaia_source_id` field — see § Gaia DR3 Apsis surfacing
for its coverage and the runtime colour-LUT re-key it enables.

- Header (32 bytes)
  - 0–3   ASCII `HYG9`
  - 4–7   `uint32` version (currently 9)
  - 8–11  `uint32` count
  - 12–15 `uint32` nameTableOffset
  - 16–19 `uint32` nameTableLength
  - 20–31 reserved
- Record (100 bytes per star)
  - 0–11  `float32 × 3`  x, y, z in parsecs (equatorial, Sol at origin)
  - 12–15 `float32`      absmag — **intrinsic** (de-extincted). The build
                          subtracts the Sol→star Edenhofer A_V so the runtime
                          raymarch re-adds it without double-counting (see
                          `distance/README.md` § Build-time de-extinction).
  - 16–19 `float32`      ci (intrinsic B–V colour index, de-reddened by the
                          same integral; default 0.65 for missing)
  - 20–23 `float32`      physicalRadius in solar radii (computed at build time)
  - 24–27 `uint32`       companionIdx (record index of binary companion; `0xFFFFFFFF` = none)
  - 28–31 `uint32`       nameOffset (into name table, valid when flag bit 0 set; `0` = none)
  - 32    `uint8`        spectClass (0=O 1=B 2=A 3=F 4=G 5=K 6=M 7=C/S/W 8=?)
  - 33    `uint8`        luminosityClass (0=VII/D … 9=Ia+/0, 255=unknown — see below)
  - 34    `uint8`        constellation index (0–87 into `constellations.json`;
                          255=none). **Positional**, resolved from the record's
                          own xyz against the IAU boundaries — see
                          `parse/README.md` § Positional constellation
                          membership. Sol is the only record carrying 255, and
                          the build asserts it. The constellation a
                          designation is *named* for is a separate field,
                          search-index `dc` (§ Search index).
  - 35    `uint8`        flags (bit 0=has_name, 1=is_sol, 2=has_bayer,
                          4=is_binary_primary). `has_name` means an authority
                          NAMED this star — the name table carries the naming
                          ladder's authority tiers alone (`naming/README.md`).
  - 36    `uint8`        **variability amplitude** in 0.05 mag units (0 = not variable)
  - 37    `uint8`        **variability type** (`VAR_TYPE_*`: 0=unknown,
                          1=pulsating, 2=eclipsing, 3=other; 4+ refine
                          pulsating into families — 4=Mira, 5=semiregular,
                          6=Cepheid, 7=RR Lyr, 8=DSCT-class — keying the
                          runtime per-type radius/colour-swing table,
                          `pulsation-params-pure.ts`). Every
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
                          Read off the spine column, which froze the
                          native-cell → HIP-cross-walk precedence and both
                          binding gates; the build re-derives nothing
                          (`spine/README.md`). IDs routinely exceed 2^53 so
                          the JS reader exposes them via `BigUint64Array`.
                          The ~0.4% residual is dominated by Gaia-saturated
                          bright binaries (Sirius, Vega, Procyon, …) absent
                          from both AT-HYG and the cross-walk; their orbital
                          rendering flows through
                          `data/binaries/multiples.tsv` instead.
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
                          Cartesian, Sol at origin). See
                          `parse/README.md` § Space-motion velocity.
  - 88–91 `float32`      **vy** — space-motion velocity y (pc/yr).
  - 92–95 `float32`      **vz** — space-motion velocity z (pc/yr).
  - 96    `uint8`        **multiplicity_status** (`MULTIPLICITY_*`:
                          0=single, 1=resolved — a multiples.tsv member
                          row backs the record, 2=unresolved — SIMBAD
                          otype `**` with nothing resolved). See
                          `multiplicity/README.md` § Multiplicity status.
  - 97–99 reserved (zero-filled; `RECORD_RESERVED_TAIL_BYTES` — a field
                          taking a reserved byte still bumps the version).
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
`HEADER_LAYOUT`, `RECORD_LAYOUT`, `RECORD_FIELD_KINDS`, `HEADER_SIZE`,
`RECORD_SIZE`, `MAGIC`, `BINARY_VERSION`, `NO_COMPANION`, and `NO_APSIS`.
Writer (`scripts/catalog/build-catalog.ts`), runtime reader
(`src/client/loaders/catalog-loader.ts`), and the verify tool
(`scripts/catalog/validate/verify-catalog.ts`) all index off those constants —
there are no inline byte offsets to drift apart. If you add fields,
extend `RECORD_LAYOUT` + `RECORD_FIELD_KINDS` and **bump
`BINARY_VERSION` + `MAGIC`** in `catalog-pure.ts`.

**Both directions of the record codec live in `catalog-pure.ts`**, so no
consumer spells out a `view.get*` / `view.set*` byte read of its own:

| Direction | Surface | Consumers |
| --- | --- | --- |
| write | `writeStarRecord`, `writeCatalogHeader` | `build-catalog.ts`, loader round-trip tests |
| read, one record | `readRecordField`, `readRecordFieldBig` | `catalog-lookup.ts` (AoS) |
| read, one column × all records | `decodeRecordColumn`, `decodeRecordColumnBig` | `catalog-loader.ts` (SoA) |
| read, header / name table | `readCatalogHeader`, `readNameTable` | both readers |

Each picks its `view.get*` call from `RECORD_FIELD_KINDS`, so a field's
declared wire type and the bytes a reader pulls cannot disagree. The two
read shapes exist because the sinks differ, not the bytes: the AoS reader
yields one `CatalogRecord` object per call, while the SoA loader fills
parallel typed arrays and does so **column-at-a-time** — one kind
dispatch per column, then a tight constant-getter loop, which decodes the
330k-record catalog ~35% faster than a per-record pass over every field.
`scripts/catalog/catalog-pure.test.ts` § record reader surface pins the
two read shapes against each other and against the writer. Free flag bits today are `0x40`, `0x80` (see
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
reconstructs the source buffer byte-for-byte. The manifest also carries
the optional `sidSuccessors` side-field (retired sid → successor sid
pairs, docs/sid.md § 9.4, derived from `data/sid/retirements.tsv` net
of reinstatements) so the runtime SID resolver can follow merge-type
retirements without an extra fetch; omitted while empty.

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
`UPDATE_BUILD_COUNTS=1 pnpm run build:catalog`; an unintended drift
exits non-zero with a per-key diff. `scripts/catalog/build-counts.ts` carries
the pure comparator + formatter and has its own vitest coverage; the
assert-or-rewrite side is `../util/snapshot-assert.ts`.
`UPDATE_BUILD_COUNTS=1` / `UPDATE_DISTANCE_OUTLIERS=1` force a rebuild even
when the sources are unchanged, so an up-to-date tree can still refresh a
snapshot. `isUpToDate` walks `scripts/catalog/` recursively plus `scripts/util/` and
`scripts/sid/`, so editing any build module invalidates the artifact — with no
exclusions: `classic-ids/` used to be skipped as a one-shot generator and is now
the label layer, `spine/` is in because `parse/` imports its codec, and so is
`validate/`.

## SID allocation

Each record's `sid` (byte 80) is its frozen Stellata ID resolved from the
committed ledger (`data/sid/`, docs/sid.md). The build is a pure
**consumer**: `starDesignations` (in `scripts/sid/sid-pure.ts` — the same
extractor `sid:allocate` uses, so both derive an identical class per record)
builds each record's designation set, and `resolveSids` maps it to the
existing ledger sid. The build **never mints** — `sid:allocate` is the sole
ledger writer (docs/sid.md § 4.4).

A record set that changes (a new spine, new companions) therefore needs a
build → `sid:allocate` → build cycle: the first build writes `NO_SID` for
anything the ledger lacks so the artifact still lands, then hard-fails
listing it. `scripts/sid/README.md` carries the mint and its review.

The runtime reader (`catalog-loader.ts`) decodes the column into
`Catalog.sid`, the star domain of the runtime SID resolver
(`src/client/util/sid-resolver/README.md`); the Node reader
(`catalog-lookup.ts`) inherits the field off `RECORD_LAYOUT` without
decoding it.

## Search index (`public/search-index.json`)

Separate from `catalog.bin` so the main binary stays rendering-focused.
One JSON array entry per star with at least one searchable identifier — a
name, a designation, a catalogue number, or a WDS component letter, since
a component composes its label from its system. Short keys
(`i/p/b/bx/bc/f/gd/gh/g/hip/hd/hr/hda/hra/gl/c/dc/s/cl/cp/al`) to keep
wire size down — file is ~15 MB raw, ~4 MB gzipped. Loaded in parallel
with `catalog.bin` in `main.ts`.

**The entry is a structured designation SET, not a set of labels** — `p`
the record's NAME, `b`/`bx`/`bc` the Bayer glyph with its index and the
component the authority attributes it to, `f`/`gd`/`gh` the Flamsteed and
Gould numbers, `al` the spellings the ladder displaced. Nothing on the
wire is a composed string and nothing parses one; `naming/README.md`
§ Two callers, one composer owns the rest.

`hda`/`hra` carry the further HD / HR numbers a record answers to but does
not display, on 95 entries (`classic-ids/README.md` § An alias stops at the
blend). The `s` field carries the raw spectral designation from the
spine's printed `spect` cell ("G2 V", "M1.5Iab-b", "K0III+K7V", …) for the
hover tooltip display. The `g` field carries the GCVS variable-star
designation (`R CrB`, `VY CMa`, `V0645 Cen`) the cross-match attaches
(`parse/gcvs/README.md`). ~14.1k stars are named (`gcvsNamed`), a superset
of the ~4.1k with a renderable period (`gcvsMatched`): a designation is
attached on name-resolution alone, so aperiodic variables (Proxima =
V0645 Cen, R CrB, T Tau, novae) are searchable but never pulsate.

Multiple-star components additionally carry `cl` (canonical WDS component
letter) + `cp` (the record its system's designation comes from), emitted
by `buildComponentDesignations` (`companions/record-index/`) after the
row-index map is built — resolving each `multiples.tsv` component through
the same `gaia → hip → synth` priority `build-runtime-binaries.py` uses.
The pair drives both the composed display label ("Sirius B") and the
runtime "<system> <letter>" aliases ("Alpha Centauri C" / "α Cen C" →
Proxima). `cp` is the WDS ROOT's anchor, not the pair cursor's:
`companions/record-index/README.md` § Component-letter search
designations. Coverage is bounded by what decomposes in `multiples.tsv`
(`componentDesignations` in build-counts pins the total).

`c` is the record's **positional** constellation (byte 34) and drives the
dropdown's context line; `dc` is the constellation a designation is *named*
for, and is the one every alias and display label is built against. `dc`
ships only where the two diverge AND the entry carries a
constellation-relative designation (`b`/`f`/`gd`/`g`/`cl`) — **68** entries,
`designationConMismatch` — so the reader's `designationConIndex(dc, c)`
fallback carries the rest at no wire cost. The cascade behind the field:
`naming/README.md` § The designation constellation.

Field shape pinned in `scripts/catalog/catalog-pure.ts` as the `SearchEntry`
interface — the writer (`build-catalog.ts`) and the reader
(`src/client/typeahead/search.ts`) both import it; drift = compile error.

Which forms dispatch to an exact-match map and which are Fuse-fuzzy, and
every ASCII / constellation-expanded spelling derived off the structure
above, are the reader's own:
`src/client/typeahead/README.md` § Star search.

The dropdown deduplicates by star index so a star with multiple matching
Bayer variants shows up once.

## Gaia DR3 Apsis surfacing

`scripts/catalog/build-catalog.ts` loads `data/gaia/gaia_dr3_apsis.tsv`
via `parseGaiaApsisTsv` into a `Map<source_id, ApsisRow>` and writes
seven `float32` Apsis fields per record into the v6 binary (offsets
52–79; see § Binary catalog format above). Coverage: ~99.6% of records
that resolve to a Gaia source_id match an Apsis row; ~85% have a
non-null Teff in either gspphot or gspspec. The remaining ~15%
(typically faint Tycho-only stars without high-S/N BP/RP photometry,
plus hot O/B stars where gspphot doesn't converge) are written as
`NaN` (the `NO_APSIS` sentinel).

The seven floats are surfaced directly to the runtime via
`catalog-loader.ts`'s per-array views, one per column named above.
Consumers test absence with `Number.isNaN(arr[i])`. Today's downstream
consumers:

- **Per-star colour routing.** The shader is two-tier —
  `iTeffApsis > 0 ? Ballesteros(iTeffApsis) : iCi` — so `bestApsisTeff`
  (`star-color-routing-pure.ts`) writes the best Apsis Teff to the
  `iTeffApsis` attribute, and the lower tiers are baked into `iCi` at
  build: a measured B−V from `photometry/`'s three-tier cascade, or the
  intrinsic spectral-class colour `spectralClassCi`
  (`spectral/physical-radius.ts`) derives when a no-Apsis star has no
  measured B−V but a parseable class (`ciSpectralDerived` in build-counts),
  else the solar fallback.
- **Spectral classification fall-through** — GSP-Spec's
  `spectraltype_esphs` enum is the tier above `SPECTRAL_UNKNOWN` in
  `spectral/README.md`'s resolver chain.
- **Per-record handles** for future Phase 5 consumers (geometric
  occlusion photometry's limb-darkening Teff dependence; mass-ratio
  refinement using direct `logg_gspphot` for giant / subgiant
  classification) — already loaded; no rebuild needed when those
  consumers come online.

Data refresh: `pnpm run refresh:gaia-apsis`. Science framing:
`docs/science-catalog-ingestion.md` § Astrophysical parameters from
Gaia DR3 Apsis.
