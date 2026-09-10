# Catalog build

Single-star catalogue build pipeline: the membership manifest + GCVS + CCDM +
Bailer-Jones + Gaia Apsis + SIMBAD sp_type +
Stellarium → `public/catalog.bin.<i>` transport chunks +
`public/catalog-manifest.json` + `public/constellations.json` +
`public/search-index.json` + `public/catalog-row-index-map.json` +
`public/constellation-boundaries.json`.
Run via `pnpm run build:catalog`.

Membership is `data/membership/membership-manifest.tsv` less the § 6.1 parks,
and nothing else — `data/athyg/` left this build's input set entirely. Classic
designations arrive already merged, so this build applies no label layer of its
own. Contract: `docs/catalog-driver.md`; term: `membership/README.md`.

This file owns the **orchestration**: which stage runs when, SID allocation,
and the Apsis surfacing. The on-disk contract the build writes — the record
layout, its codec, the chunk plan and the search-index wire entry — is
`record/README.md`; the per-stage work is in the other subfolders.

## Subfolders

- `record/` — the on-disk contract: the v9 `catalog.bin` layout with both
  directions of its codec, the transport chunk plan, and the `SearchEntry`
  wire shape. `catalog-pure.ts` alone, imported by every other subfolder and
  by `src/client/loaders/`, importing back from none of them.
- `astrometry-request/` — the Gaia 5p pull's source_id list: the manifest's
  `gaia_source_id` column, both binding gates' candidates (overlay and
  derivation), and the bound-pair siblings. Input prep, off `build:catalog`.
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
  (`pnpm run build:classic-ids` → `data/classic-ids/`) and the per-identifier
  label merge `build:membership` runs and writes the queue for. The record
  build takes only the designation-constellation cascade, over `readStars`.
- `simbad/` — the readers for the two per-source SIMBAD pulls the build joins
  on, and the identifier rule the TYC → HD witness settles: which of a close
  pair's two components a record's cells name.
- `membership/` — the membership term: the primaries-derived manifest
  (`pnpm run build:membership` → `data/membership/`), its parity gate and the
  § 6.1 ledgers. `parse/` streams it through `iterManifestTsv`.
- `spine/` — AT-HYG's merge decisions, frozen: `data/athyg/inherited-spine.tsv`,
  its codec and byte guard. Read by `build:membership` and the manifest gate,
  never by `build:catalog`.
- `validate/` — the Tier-A/B validation harness, `verify-catalog`, the
  SIMBAD-sample cross-check, and the frozen regression corpora.

## Files in this area

```
scripts/catalog/
  build-catalog.ts                Orchestrator. Reads every reference
                                  catalogue, runs the per-row pipeline and
                                  each cross-match pass in order, then
                                  writes the chunked binary + manifests.
  cited-proper-motion.ts (+ test) `CitedProperMotion` and `CitedParallax`,
  cited-parallax.ts               with their only constructors: a value is
                                  admitted only with the bibcode that sourced
                                  it, so an uncited one is unrepresentable.
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

## SID allocation

Each record's `sid` (byte 80) is its frozen Stellata ID resolved from the
committed ledger (`data/sid/`, docs/sid.md). The build is a pure
**consumer**: `starDesignations` (in `scripts/sid/sid-pure.ts` — the same
extractor `sid:allocate` uses, so both derive an identical class per record)
builds each record's designation set, and `resolveSids` maps it to the
existing ledger sid. The build **never mints** — `sid:allocate` is the sole
ledger writer (docs/sid.md § 4.4).

A record set that changes (a new manifest, new companions) therefore needs a
build → `sid:allocate` → build cycle: the first build writes `NO_SID` for
anything the ledger lacks so the artifact still lands, then hard-fails
listing it. `scripts/sid/README.md` carries the mint and its review.

The runtime reader (`catalog-loader.ts`) decodes the column into
`Catalog.sid`, the star domain of the runtime SID resolver
(`src/client/util/sid-resolver/README.md`); the Node reader
(`catalog-lookup.ts`) inherits the field off `RECORD_LAYOUT` without
decoding it.

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
