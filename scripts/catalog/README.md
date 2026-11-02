# Catalog build

Single-star catalogue build pipeline: the membership manifest + GCVS + CCDM +
[Bailer-Jones 2021](/data/papers/index.md#bailerjones2021) + Gaia
Apsis + SIMBAD sp_type +
Stellarium → `public/catalog.bin.<i>` transport chunks +
`public/catalog-manifest.json` + `public/constellations.json` +
`public/search-index.json` + `public/constellation-boundaries.json`, plus the
build-only `build/catalog-row-index-map.json` ([What ships](../README.md#what-ships)).
Run via `pnpm run build:catalog`.

Membership is `data/membership/membership-manifest.tsv` less the [§ 6.1](/docs/catalog-driver.md#61-record-parity) parks,
and nothing else — `data/athyg/` left this build's input set entirely. Classic
designations arrive already merged, so this build applies no label layer of its
own. Contract: `docs/catalog-driver.md`; term: `membership/README.md`.

This file owns the **orchestration**: which stage runs when, SID allocation,
and the Apsis surfacing. The on-disk contract the build writes — the record
layout, its codec, the chunk plan and the search-index wire entry — is
`/src/catalog-format/record/README.md`; the per-stage work is in the other subfolders.

## Subfolders

- `record/` — the on-disk contract: the v10 `catalog.bin` layout with both
  directions of its codec, the record order, the transport chunk plan, and
  the `SearchEntry` wire shape. `catalog-pure.ts` alone, imported by every other subfolder and
  by `src/client/loaders/`, importing back from none of them.
- `astrometry-request/` — the Gaia 5p pull's source_id list: both binding
  gates' candidates (overlay and derivation), the bound-pair siblings and the
  review dispositions' kept ids. Input prep, off `build:catalog`.
- `parse/` — the per-row pipeline (`readStars`), reference-catalogue
  parsers and space-motion velocity. Its `gcvs/` subfolder owns the
  variable-star parsing and the variability cross-match; `constellations/`
  owns the IAU-88 table, byte 34's positional membership and the
  Stellarium stick figures.
- `spectral/` — Morgan-Keenan parsing of SIMBAD `sp_type`, the seven-tier
  spectral resolver, and the Stefan-Boltzmann radius chain. Imports the
  namespace ladder from `record/record-build-pure.ts`; nothing there imports back.
- `boundaries/` — `public/constellation-boundaries.json`: the IAU boundary
  arcs resampled and precessed to ICRS, the per-region label anchors, the
  resolved cell grid the runtime resolves membership against, and the
  magnitude-keyed fade-quantile table the chart-mode layer derives its
  fade window from.
- `companions/` — promotion of `data/binaries/multiples.tsv` secondaries
  into first-class catalog records. Its `record-index/` subfolder holds
  everything that addresses records *after* the apparent-V sort
  ([Record order](../../src/catalog-format/record/README.md#record-order)): the row-index
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
  [§ 6.1](/docs/catalog-driver.md#61-record-parity) ledgers. `parse/` reads it through `MEMBERSHIP_MANIFEST`, its codec.
- `spine/` — AT-HYG's merge decisions, frozen: `data/athyg/inherited-spine.tsv`,
  its codec and byte guard. Read by `build:membership` and the manifest gate,
  never by `build:catalog`.
- `lineage/` — record lineage: every stage's per-record decision with its
  reason code and cited source rows, keyed on the record's origin source
  row; the trace command, the run-to-run diff, and the committed ledgers as
  views of it.
- `validate/` — the Tier-A/B validation harness, `verify-catalog`, the
  SIMBAD-sample cross-check, and the frozen regression corpora.

## Files in this area

```
scripts/catalog/
  build-catalog.ts                Orchestrator. Reads every reference
                                  catalogue, runs the per-row pipeline and
                                  each cross-match pass in order, then
                                  allocates every record's SID, then
                                  emits the chunked binary, manifests,
                                  both committed ledgers, the SID registry
                                  and placement's, promotion's and
                                  allocation's lineage through emitArtifacts
                                  once its two snapshot checks, the three
                                  lineage budgets, placement's lineage
                                  invariants (lineage/README.md#invariants)
                                  and the CI heap budget
                                  (../util/README.md#ci-heap-budget) pass.
                                  A failed allocation throws before
                                  anything is staged
                                  ([SID allocation](#sid-allocation)).
  catalog-inputs.test.ts          Pins stepInputPaths('build:catalog')
                                  (../util/step-inputs.ts) — every file the
                                  build reads, which its content-hash stamp
                                  keys: the import closure plus sibling
                                  snapshots (the rule CI's cache key shares)
                                  and every declared source and artifact that
                                  closure reads, less the build's own
                                  outputs.
  catalog-outputs.ts (+ test)     CATALOG_OUTPUTS — every file the build
                                  writes, as its emitArtifacts declaration
                                  (../util/README.md): the public/ sidecars,
                                  the row-index map, the two committed
                                  ledgers, the catalogue's SID registry
                                  partition (registryFiles), placement's,
                                  promotion's and allocation's lineage
                                  files, and
                                  the transport chunks and the lineage
                                  baseline and diff as families, the last
                                  two unstamped. Side-effect free, so a reader can
                                  import the declaration without running
                                  the build.
  cascade-result.ts               `CascadeResult`, the one shape every
                                  per-field cascade returns: the tier that
                                  answered with its value, or `none`, and on
                                  both the candidates it refused, each a
                                  `CascadeRefusal` (tier + coded reason, the
                                  tier checked against the cascade's own) —
                                  what the stage lineage projects.
                                  `CitedCascadeResult` adds the source rows
                                  the answer rests on (`evidence`) and the
                                  row each `CitedRefusal` refused (`ref`):
                                  the four placement cascades return it.
  cited-proper-motion.ts (+ test) `CitedProperMotion` and `CitedParallax`,
  cited-parallax.ts               with their only constructors: a value is
                                  admitted only with the bibcode that sourced
                                  it, so an uncited one is unrepresentable.
                                  `MeasuredParallax`, the value + error pair
                                  every parallax source and the cascade's
                                  resolution share, lives beside it with
                                  `parallaxSignalToNoise` — a leaf, so the
                                  record codec can import it without pulling
                                  the cascade into vite.config.ts's graph.
  tycho2-source.ts                TYCHO2: main and supplement 1 as one
                                  declared source (../util/sources/).
  tycho2-parse.ts (+ test)        data/tycho2/ indexed on the full TYC, with
                                  the position-to-propagate-from choice and
                                  the main-table-wins rule resolved at parse
                                  time (data/tycho2/README.md). Feeds the
                                  direction, PM-rescue and V cascades.
  gliese-source.ts                GLIESE, V/70A's declaration.
  gliese-parse.ts (+ test)        data/gliese/ keyed on the bare Gliese
                                  number + component, so the catalogue's four
                                  name prefixes and a record's `gl` cell meet
                                  (data/gliese/README.md). Bottom tier of the
                                  V cascade, trigonometric tier of parallax.
  catalog-lookup.ts (+ test)      Reads a built catalog back (loadCatalog) — the
                                  shared reader for verify-catalog, the frozen
                                  corpora, validate-simbad-sample, trace.
                                  A `name:` record ref resolves through the
                                  name table AND the composed display labels,
                                  so a corpus row may name a star by the
                                  designation it displays (`naming/README.md`).
                                  That match is exact and refuses a name
                                  two records answer to (`54 Leo`, a HIP
                                  primary and a Gaia-only companion);
                                  `nameTable` hands
                                  trace the same table for its folded one
                                  (lineage/README.md#trace).
  build-counts.ts (+ test)        Per-strategy / per-tier count snapshot
                                  comparator, pinned by
                                  build-catalog-expected.json. Generic over
                                  the count record: compareCountSnapshot is
                                  the compare every count snapshot passes
                                  (consumer list: the snapshot-check.ts
                                  entry of ../util/README.md).
```

## SID allocation

Each record's `sid` (byte 80) is its Stellata ID, and this build is the
step that allocates it ([§ 4.4](/docs/sid.md#44-allocation)). After the record sort and before the
display names (which key on SIDs), `catalogSidObjects`
(`scripts/sid/catalog-objects.ts`) builds every record's designation set
with `starDesignations` and appends the sol and shell lists; `allocate`
(`scripts/sid/allocate-pure.ts`) resolves each against the committed
ledger, mints what is new — past the highest SID in any registry partition,
the clouds' and Local Group's included — under the code of the lineage decision that
admitted it, and settles every SID no record keeps by its upstream
decision ([SID events](../sid/README.md#sid-events)). Membership's lineage
comes from the last `build:membership` (`build/lineage/`, declared in
`membership/membership-lineage-source.ts`, so this build keys on it);
placement's and promotion's from this run.

New ledger rows and events land in the catalogue's partition with the rest
of the outputs (`registryTexts`), and allocation's lineage beside the other stages'. A
failed allocation — an orphan no decision explains, a new record no stage
admits — throws before anything is staged, so nothing lands.
`scripts/sid/README.md` carries the review side.

The runtime reader (`catalog-loader.ts`) decodes the column into
`Catalog.sid`, the star domain of the runtime SID resolver
(`src/client/util/sid-resolver/README.md`); the Node reader
(`catalog-lookup.ts`) inherits the field off `RECORD_LAYOUT` without
decoding it.

## Gaia DR3 Apsis surfacing

`loadReadStarsInputs` (`parse/read-stars-inputs.ts`) loads `data/gaia/gaia_dr3_apsis.tsv`
through `GAIA_APSIS` (`record/gaia-apsis-source.ts`) into a `Map<source_id, ApsisRow>`, and
`build-catalog.ts` writes
seven `float32` Apsis fields per record into the v6 binary (offsets
52–79; see [Binary catalog format](../../src/catalog-format/record/README.md#binary-catalog-format-publiccatalogbini--manifest) above). Coverage: 98.7% of records
match an Apsis row (<!-- count:build-catalog/apsisMatched -->967,310<!-- /count --> of <!-- count:build-catalog/recordCount -->979,678<!-- /count -->); 88.3% of the catalogue has a
non-null Teff in either gspphot or gspspec. The remaining ~12%
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
  (`/src/catalog-format/spectral/physical-radius.ts`) derives when a no-Apsis star has no
  measured B−V but a parseable class (`ciSpectralDerived` in build-counts),
  else the solar fallback.
- **Spectral classification fall-through** — ESP-ELS's
  `spectraltype_esphs` enum is the tier above `SPECTRAL_UNKNOWN` in
  `spectral/README.md`'s resolver chain.
- **Per-record handles** for future Phase 5 consumers (geometric
  occlusion photometry's limb-darkening Teff dependence; mass-ratio
  refinement using direct `logg_gspphot` for giant / subgiant
  classification) — already loaded; no rebuild needed when those
  consumers come online.

Data refresh: `pnpm run refresh:gaia-apsis`. Science framing:
[Astrophysical parameters from Gaia DR3 Apsis](/docs/science-catalog-ingestion.md#astrophysical-parameters-from-gaia-dr3-apsis).
