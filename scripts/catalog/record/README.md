# Catalog record — the on-disk contract

The shapes the build writes and the runtime reads: the v9 `catalog.bin` record
layout with both directions of its codec, the transport chunk plan, and the
`search-index.json` wire entry. `catalog-pure.ts` is the single statement of
all three, which is why every subfolder and `src/client/loaders/` import it and
it imports back from none of them but `../parse/corpus-tsv.ts` and
`../distance/parallax/`.

## Files in this area

```
scripts/catalog/record/
  catalog-pure.ts (+ test)        The v9 binary layout and its codec, the
                                  chunk plan, the SearchEntry wire shape, the
                                  aliased-id index the runtime dispatches
                                  search on, the override math the distance
                                  stack applies (`../distance/README.md`), and
                                  the SIMBAD namespace ladder both SIMBAD pulls
                                  index and join through
                                  (`../spectral/README.md` § The ladder is
                                  ordered by what an identifier names). Pure.
```

## Binary catalog format (`public/catalog.bin.<i>` + manifest)

Fixed-size records, sorted brightest-first by `absmag`. Current version is
**v9** with a 100-byte stride. Magic and version step together
(v3=`HYG3` … v8=`HYG8`, v9=`HYG9`). v9 appended a `uint8`
`multiplicity_status` at byte 96 (bytes 97–99 reserved, zero-filled, so
the stride stays a multiple of 4) — see `../multiplicity/README.md` § Multiplicity status. v8
appended three `float32` space-motion velocity components (`vx/vy/vz`,
pc/yr) at bytes 84–95 — see `../parse/README.md` § Space-motion velocity. v7 appended a `uint32` `sid` (Stellata ID)
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
                          `../distance/README.md` § Build-time de-extinction).
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
                          `../parse/README.md` § Positional constellation
                          membership. Sol is the only record carrying 255, and
                          the build asserts it. The constellation a
                          designation is *named* for is a separate field,
                          search-index `dc` (§ Search index).
  - 35    `uint8`        flags (bit 0=has_name, 1=is_sol, 2=has_bayer,
                          4=is_binary_primary). `has_name` means an authority
                          NAMED this star — the name table carries the naming
                          ladder's authority tiers alone (`../naming/README.md`).
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
                          Read off the manifest column, whose `binding`
                          cell says how it is justified; the build
                          re-derives nothing (`../membership/README.md`
                          § The identifier columns are read, never
                          re-derived). IDs routinely exceed 2^53 so
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
                          `../parse/README.md` § Space-motion velocity.
  - 88–91 `float32`      **vy** — space-motion velocity y (pc/yr).
  - 92–95 `float32`      **vz** — space-motion velocity z (pc/yr).
  - 96    `uint8`        **multiplicity_status** (`MULTIPLICITY_*`:
                          0=single, 1=resolved — a multiples.tsv member
                          row backs the record, 2=unresolved — SIMBAD
                          otype `**` with nothing resolved). See
                          `../multiplicity/README.md` § Multiplicity status.
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

The byte plan above is encoded once in `scripts/catalog/record/catalog-pure.ts` as
`HEADER_LAYOUT`, `RECORD_LAYOUT`, `RECORD_FIELD_KINDS`, `HEADER_SIZE`,
`RECORD_SIZE`, `MAGIC`, `BINARY_VERSION`, `NO_COMPANION`, and `NO_APSIS`.
Writer (`../build-catalog.ts`), runtime reader
(`src/client/loaders/catalog-loader.ts`), and the verify tool
(`../validate/verify-catalog.ts`) all index off those constants —
there are no inline byte offsets to drift apart. If you add fields,
extend `RECORD_LAYOUT` + `RECORD_FIELD_KINDS` and **bump
`BINARY_VERSION` + `MAGIC`** in `catalog-pure.ts`.

**Both directions of the record codec live in `catalog-pure.ts`**, so no
consumer spells out a `view.get*` / `view.set*` byte read of its own:

| Direction | Surface | Consumers |
| --- | --- | --- |
| write | `writeStarRecord`, `writeCatalogHeader` | `../build-catalog.ts`, loader round-trip tests |
| read, one record | `readRecordField`, `readRecordFieldBig` | `../catalog-lookup.ts` (AoS) |
| read, one column × all records | `decodeRecordColumn`, `decodeRecordColumnBig` | `catalog-loader.ts` (SoA) |
| read, header / name table | `readCatalogHeader`, `readNameTable` | both readers |

Each picks its `view.get*` call from `RECORD_FIELD_KINDS`, so a field's
declared wire type and the bytes a reader pulls cannot disagree. The two
read shapes exist because the sinks differ, not the bytes: the AoS reader
yields one `CatalogRecord` object per call, while the SoA loader fills
parallel typed arrays and does so **column-at-a-time** — one kind
dispatch per column, then a tight constant-getter loop, which decodes the
390k-record catalog ~35% faster than a per-record pass over every field.
`scripts/catalog/record/catalog-pure.test.ts` § record reader surface pins the
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
block in `scripts/catalog/record/catalog-pure.test.ts`.

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
all three consumers: the writer (`../build-catalog.ts`), the runtime loader
(`src/client/loaders/catalog-loader.ts`, fetch), and the Node test/verify
reader (`../catalog-lookup.ts` `readCatalogBuffer`, fs). The build removes a
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
the label layer, `membership/` is in because `parse/` imports its codec, and
so is `validate/`.

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
wire is a composed string and nothing parses one; `../naming/README.md`
§ Two callers, one composer owns the rest.

`hda`/`hra` carry the further HD / HR numbers a record answers to but does
not display — the manifest's `hd_alt` / `hr_alt` cells
(`../classic-ids/label-merge/README.md` § An alias stops at the blend). The `s` field carries
the raw spectral designation the spectral resolver settled on ("G2 V",
"M1.5Iab-b", "K0III+K7V", …) for the hover tooltip display. The `g` field carries the GCVS variable-star
designation (`R CrB`, `VY CMa`, `V0645 Cen`) the cross-match attaches
(`../parse/gcvs/README.md`). ~14.1k stars are named (`gcvsNamed`), a superset
of the ~4.1k with a renderable period (`gcvsMatched`): a designation is
attached on name-resolution alone, so aperiodic variables (Proxima =
V0645 Cen, R CrB, T Tau, novae) are searchable but never pulsate.

Multiple-star components additionally carry `cl` (canonical WDS component
letter) + `cp` (the record its system's designation comes from), emitted
by `buildComponentDesignations` (`../companions/record-index/`) after the
row-index map is built — resolving each `multiples.tsv` component through
the same `gaia → hip → synth` priority `build-runtime-binaries.py` uses.
The pair drives both the composed display label ("Sirius B") and the
runtime "<system> <letter>" aliases ("Alpha Centauri C" / "α Cen C" →
Proxima). `cp` is the WDS ROOT's anchor, not the pair cursor's:
`../companions/record-index/README.md` § Component-letter search
designations. Coverage is bounded by what decomposes in `multiples.tsv`
(`componentDesignations` in build-counts pins the total).

`c` is the record's **positional** constellation (byte 34) and drives the
dropdown's context line; `dc` is the constellation a designation is *named*
for, and is the one every alias and display label is built against. `dc`
ships only where the two diverge AND the entry carries a
constellation-relative designation (`b`/`f`/`gd`/`g`/`cl`) — **69** entries,
`designationConMismatch` — so the reader's `designationConIndex(dc, c)`
fallback carries the rest at no wire cost. The cascade behind the field:
`../naming/README.md` § The designation constellation.

Field shape pinned in `scripts/catalog/record/catalog-pure.ts` as the `SearchEntry`
interface — the writer (`../build-catalog.ts`) and the reader
(`src/client/typeahead/search.ts`) both import it; drift = compile error.

Which forms dispatch to an exact-match map and which are Fuse-fuzzy, and
every ASCII / constellation-expanded spelling derived off the structure
above, are the reader's own:
`src/client/typeahead/README.md` § Star search.

The dropdown deduplicates by star index so a star with multiple matching
Bayer variants shows up once.
