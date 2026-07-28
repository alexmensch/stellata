# Catalog build

Single-star catalogue build pipeline: AT-HYG + GCVS + CCDM +
Bailer-Jones + Gaia Apsis + SIMBAD sp_type + SIMBAD WDS cross-IDs +
Stellarium → `public/catalog.bin.<i>` transport chunks +
`public/catalog-manifest.json` + `public/constellations.json` +
`public/search-index.json` + `public/catalog-row-index-map.json`.
Run via `pnpm run build:catalog`.

The AT-HYG-retirement plan (Gaia-native membership + classic-ID label
overlay) is designed in `docs/catalog-driver.md`.

`build-catalog.ts` is the orchestrator; `catalog-pure.ts` is the single
source of truth for the v9 binary layout, the override math, and the
spectral resolver — every subfolder imports it, and so do twelve
runtime modules under `src/client/`. This file owns the **output
contract**: the on-disk record layout, SID allocation, the search
index, and the Apsis surfacing. The per-stage work lives in the
subfolders.

## Subfolders

- `parse/` — the per-row pipeline (`readStars`), reference-catalogue
  parsers, space-motion velocity, spectral/radius resolution, the GCVS
  variability cross-match, and Stellarium stick figures.
- `companions/` — promotion of `data/binaries/multiples.tsv` secondaries
  into first-class catalog records, plus the renderable-companion wings
  and component-letter stamping passes.
- `multiplicity/` — multiplicity status, geometric binary inference, the
  CCDM double-star cross-match with its optical-double suppression
  cascade, and system distance coherence.
- `distance/` — direction resolution, build-time de-extinction, and the
  multi-layer distance-refinement override stack with its
  authoring discipline and post-build regression check.
- `classic-ids/` — the frozen-CDS classic-designation overlay build
  (`pnpm run build:classic-ids` → `data/classic-ids/`). Not part of
  `build:catalog`; no consumer here yet.
- `spine/` — the one-shot inherited-spine generator
  (`pnpm run build:spine` → `data/athyg/inherited-spine.tsv`). Not part of
  `build:catalog`; no consumer here yet.
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
                                  layout, override math, and the spectral
                                  resolver. Pure; imported by every
                                  subfolder and by src/client/loaders/.
  catalog-lookup.ts               Reads a built catalog back (loadCatalog) —
                                  the shared reader for verify-catalog,
                                  validate-simbad-sample, and sid:allocate.
  build-counts.ts (+ test)        Per-strategy / per-tier count snapshot
                                  comparator, pinned by
                                  build-catalog-expected.json. Generic over
                                  the count record — classic-ids/ pins its
                                  own snapshot through the same helper.
  export-astrometry-request.ts    Emits the full-catalog Gaia astrometry
    (+ -pure, + pure test)        request (§ Full-catalog astrometry
                                  request). sortSourceIdsNumeric is also
                                  used by scripts/sid/export-dr-risk-set.ts.
```

## Full-catalog astrometry request

`export-astrometry-request.ts` (run `pnpm run build:astrometry-request`)
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
input (`docs/science-catalog-ingestion.md` § Driver astrometry). This is a superset of the
shipped catalog by the handful of rows dropped at the `MAX_DIST_PC`
cutoff; over-pulling those is harmless.

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
keyed by the v5 `gaia_source_id` field — 99.6% of records match an Apsis
row, with non-null Teff in either gspphot OR gspspec on ~85% (the
population the runtime colour-LUT path can re-key from
Ballesteros(B–V) → Apsis-direct).

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
  - 34    `uint8`        constellation index (0–87 into `constellations.json`; 255=none)
  - 35    `uint8`        flags (bit 0=has_name, 1=is_sol, 2=has_bayer, 4=is_binary_primary)
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
313k-record catalog ~35% faster than a per-record pass over every field.
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
snapshot. `isUpToDate` walks `scripts/catalog/` recursively plus
`scripts/util/` and `scripts/sid/`, so editing any build module — not just a
top-level one — invalidates the artifact.

## SID allocation

Each record's `sid` (byte 80) is its frozen Stellata ID resolved from the
committed ledger (`data/sid/`, docs/sid.md). The build is a pure
**consumer**: `starDesignations` (in `scripts/sid/sid-pure.ts` — the same
extractor `sid:allocate` uses, so both derive an identical class per record)
builds each record's designation set, and `resolveSids` maps it to the
existing ledger sid. The build **never mints** — `sid:allocate` is the sole
ledger writer (docs/sid.md § 4.4).

Bootstrap when the record set changes (new AT-HYG rows, new companions):

1. `pnpm run build:catalog` resolves every record. Any object absent from the
   ledger is written with `NO_SID` (0) so the artifact still lands, then the
   build **hard-fails** listing the unallocated records.
2. `pnpm run sid:allocate` reads that catalog.bin + search-index +
   row-index-map, mints the missing sids (an explicit, reviewable
   `ledger.tsv` diff), and rewrites `ledger-head.json`.
3. `pnpm run build:catalog` again — now every record resolves and the build
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
(`parse/README.md` § GCVS variability cross-match) — the lookup key the cross-match already
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

Data refresh: `pnpm run refresh:gaia-apsis`. See
`docs/science-catalog-ingestion.md` § Astrophysical parameters from
Gaia DR3 Apsis for the science
framing.
