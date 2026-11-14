# Catalogue cross-match — binary-system pipeline

`build:binaries`: how WDS pairs cross-match against ORB6 + AT-HYG + CCDM +
HIP2 + Gaia (xmatches, NSS, 5p astrometry) + SIMBAD WDS cross-IDs + SIMBAD
per-component spectra + Tokovinin's Multiple Star Catalog (MSC) to produce
`data/binaries/multiples.tsv`, and how `build:binaries-runtime` turns that
into `public/binaries.bin`. The science of *why* the choices are made (Gaia
DR3 parallax bias, NSS detectability regimes, HIP2 long-baseline
corrections) is in `SCIENCE.md` and its `docs/science-*.md` splits
(multiple-star pipeline, catalog ingestion); this folder is the engineering
side — layered strategies, numeric thresholds, provenance fields — with each
stage's in its own subfolder's README.

## When to read this

- You're refreshing external catalogues — Gaia DR4 landed, AT-HYG cut a
  new release, B-J republished posteriors, SIMBAD updated sp_type
  bibcodes. See [Refreshing data when DR4 / new AT-HYG lands](/scripts/refresh/README.md#refreshing-data-when-dr4--new-at-hyg-lands).
- You're adding a star to the Tier-A validation corpus
  (`scripts/catalog/validate/known-stars.tsv`).
- You're debugging why a specific star doesn't render at its expected
  position, distance, or spectral colour. Start at
  `scripts/catalog/validate/README.md` — the harness localises which
  stage produced the wrong value before you read any stage.
- You're extending the multi-star pipeline — adding a new astrometry
  route, a new optical-pair filter tier, or a new SIMBAD-anchored
  cross-ID side-file.

## The stages

Seven stages in a strictly linear chain — stage N consumes every earlier
one — each a subfolder with its README carrying what its tiers decide and
why:

1. [`load/`](load/README.md) — every reference catalogue read, the
   magnitude gate, the blank-components rescue and the synthesized ORB6
   orphan and MSC inner pairs ([Sub-pair synthesis](load/README.md#sub-pair-synthesis)),
   and the one Gaia NSS solution kept per source ([Gaia NSS: one solution per source](load/README.md#gaia-nss-one-solution-per-source)).
2. [`resolve/`](resolve/README.md) — each WDS component bound to a Gaia DR3
   source and / or a HIP ([What each tier decides](resolve/README.md#what-each-tier-decides)),
   then the binding-integrity audit.
3. [`astrometry/`](astrometry/README.md) — each component's astrometry
   route, and the Gaia NSS inner pairs.
4. [`orbits/`](orbits/README.md) — each pair's orbit from ORB6, Gaia NSS or
   the MSC.
5. [`optical/`](optical/README.md) — each pair physical or optical; the
   masses its escape-velocity gate reads are [`masses/`](masses/README.md).
6. [`multiples/`](multiples/README.md) — the `multiples.tsv` records
   ([What each column carries](multiples/README.md#what-each-column-carries)).
7. [`counts/`](counts/README.md) — the count snapshot that gates the
   write.

`multiples.tsv` and the counts are pinned exactly, so each
stage's README lists the choices its outputs rest on; changing one moves
rows and is a correctness change, never a refactor.

## Files in this area

```
scripts/binaries/
  build-binaries.ts (+ test)      build:binaries: runStages calls Stages
                                  1-6 in order, then main hands
                                  multiples.tsv, the Gaia astrometry
                                  request and the binding verdicts to
                                  emitArtifacts behind the row bands and
                                  Stage 7's count snapshot check. The test
                                  runs the stages over the committed
                                  inputs, holds the records to the
                                  committed multiples.tsv and Stage 7's
                                  counts to the count snapshot, byte for
                                  byte, and runs the spot-check
                                  (pnpm run test:spotcheck,
                                  resolve/README.md#the-spot-check).
  binaries-outputs.ts             BINARIES_OUTPUTS, its declaration.
  load/ resolve/ astrometry/      Stages 1-7, one folder each (#the-stages).
  orbits/ optical/ multiples/
  counts/
  components/                     What one component reads about itself:
                                  its AT-HYG row, its spectral type and
                                  spect_via. Own README.
  masses/                         A component's mass from its spectral
                                  type, and each pair's total mass, which
                                  Stage 5 reads. Own README.
  multiples-tsv.ts (+ test)       MULTIPLES_TSV: the codec for
                                  multiples.tsv — column roster, closed
                                  value sets and the properties a set's
                                  members carry (which resolve tiers
                                  anchor on a Gaia source_id; each
                                  orbit route's elements, regime and
                                  Stage 6 estimates), per-column
                                  decimal places,
                                  P and a positive and 0 ≤ e < 1, a
                                  comp and a WDS id on every row, so
                                  every row composes a synthetic key —
                                  and
                                  the only parse of the file. Its test
                                  round-trips the committed file byte for
                                  byte. Its rowKey cites a row by
                                  (system_id, comp) for lineage
                                  (../util/sources/README.md#sourcerowref).
  component-tokens-pure.ts        WDS component-letter tokens:
    (+ test)                      wdsRootOf (a system_id's WDS id, the one
                                  spelling), composeSyntheticId (the synth-<wds>-<comp>
                                  key promotion mints and every resolver
                                  looks up), canonicalCompLetter (WDS
                                  truncation re-anchored: Aa1,2 → Aa2),
                                  parentComponentToken, isComponentToken,
                                  and relatedHier / compoundContains — the
                                  test planRecords uses to tell one link
                                  named twice from two stars collapsed onto
                                  one record. Also pairComponentTokens (a
                                  `components` field split by ../wds/'s
                                  splitComponents, its secondary
                                  re-anchored), childComponentTokens,
                                  tokenLetters and subcomponentTopLetter
                                  (the root letter, where
                                  parentComponentToken is the immediate
                                  parent); isMoreCanonicalAnchor, the
                                  order Stage 6 and companion promotion
                                  rank a root's anchor letter by. And the
                                  map keys, one branded
                                  type per key space so one cannot look up
                                  another's map: componentKey
                                  (wds_id, token), discovererKey
                                  (wds_id, discoverer), pairRowKey
                                  (wds_id, components field).
  sky-geometry-pure.ts (+ test)   The geometry the stages share:
                                  propagatePosition (linear in RA/Dec
                                  degrees, cos δ floored at 1e-3),
                                  tangentOffset, polarToTangent (a WDS
                                  ρ, θ as an east / north offset),
                                  distancePc (1000 /
                                  parallax), chordSq / positionsWithin
                                  (a tolerance test without trig),
                                  predictSecondaryPosition (a WDS ρ, θ
                                  offset), and the AT-HYG / WDS
                                  reference epochs. Not the catalogue's
                                  tangent-basis propagation
                                  (../catalog/distance/direction-cascade.ts);
                                  one formula for both is
                                  stellata-hhaw.45.17.8.
  python-float-pure.ts (+ test)   Float arithmetic multiples.tsv rests on
                                  where JavaScript's default differs: pyMod,
                                  `%` with the divisor's sign; pySum, a
                                  compensated sum.
  epochs-pure.ts (+ test)         How ORB6 and the MSC's periastron
                                  epochs read as a JD: the truncated-JD
                                  and MJD offsets, the plausible window
                                  (isPlausibleT0Jd), yearElseTruncatedJd.
  build-log-pure.ts               count and countsListed: how a build-log
                                  line prints a number and a tally, for
                                  every stage's report; and
                                  droppedPairSample, the capped sample of
                                  a gate's dropped pairs.
  multiples-row-key-pure.ts       MULTIPLES_ROW_KEY, that rowKey, for code
                                  that cites a row without reading the file
                                  (promotion's origin keys), so it never
                                  reaches the codec.
  build-runtime-binaries.ts        build:binaries-runtime: multiples.tsv +
                                  the catalogue row-index map →
                                  public/binaries.bin through emitArtifacts,
                                  after its pair-count snapshot check
                                  (#runtime-side-artifact).
  runtime-binaries-pure.ts        The writer itself: pairs joined from the
    (+ test)                      rows (a system with a role missing or
                                  doubled, or no WDS id, throws), parents by
                                  component-letter prefix,
                                  outer-before-inner walk, and planRecords —
                                  both ends resolved, unaddressable pairs
                                  dropped and counted, flags set — whose
                                  records the format's encodeBinaries
                                  writes.
  runtime-binaries-outputs.ts     RUNTIME_BINARIES_OUTPUTS, its declaration.
  golden/                         binaries.bin golden test: the writer on a
                                  committed non-LFS fixture, byte for byte.
                                  Own README.
  *-expected.json                 Count snapshots refreshed with
                                  --update-snapshots, staged by pipeline
                                  stage (../util/counts/count-stages-pure.ts;
                                  build-runtime-binaries' one stage is
                                  `encode`): build-binaries
                                  (per-strategy / per-tier counts),
                                  build-runtime-binaries (pair-emission
                                  counts).
```

Inputs and outputs live in their own folders, each with its own README
this file does not restate: `data/wds/` (WDS summary / notes / refs +
ORB6 orbits, read through `../wds/`), `data/msc/` (MSC hierarchy / orbit /
component tables), `data/binaries/` (the `multiples.tsv` output plus the
curated `component_sptype_overrides.tsv` and `orb6_component_overrides.tsv`).

## Pipeline at a glance

Three build steps in order, with `data/binaries/multiples.tsv` and
`build/catalog-row-index-map.json` as hand-offs:

1. **Binary-system pipeline** (`build-binaries.ts`). Reads WDS + ORB6 +
   AT-HYG + CCDM + HIP2 + Gaia (xmatches, NSS, 5p astrometry) + SIMBAD WDS
   cross-IDs + SIMBAD per-component spectra + the MSC. Emits
   `data/binaries/multiples.tsv` — two rows per kept physical pair, plus
   standalone rows for SIMBAD-known WDS components the pair walk didn't
   reach — with the binding-integrity verdicts
   (`build/binding-integrity-verdicts.tsv`, a gitignored review surface).
   The Gaia ids Stage 2 weighs are not an output: `build:astrometry-request`
   runs Stages 1–2 itself and unions them into the one astrometry request
   (`../catalog/astrometry-request/`). Both land through `emitArtifacts`
   only once the input row bands and the count snapshot check pass, so a
   drifted count writes nothing. `pnpm run build:binaries`.
2. **Single-star catalogue build** (`scripts/catalog/build-catalog.ts`).
   Reads the membership manifest + multiples.tsv + the SIMBAD sp_type / Gaia Apsis /
   [Bailer-Jones 2021](/data/papers/index.md#bailerjones2021) / Gaia
   HIP-xmatch side-files + Stellarium + GCVS + CCDM.
   Emits the chunked v9 `public/catalog.bin.<i>` + manifest,
   `constellations.json`, `search-index.json`, and
   `catalog-row-index-map.json`. `pnpm run build:catalog`.

   The seam that consumes this pipeline's output is companion promotion
   — it adds first-class catalog records for the secondary of every
   physical pair whose identifier isn't already in AT-HYG, so the
   renderer / picker / hover / focus stack picks companions up with zero
   code change. Gates, identifier minting, placement, and the
   field-inheritance contract:
   [Companion promotion](/scripts/catalog/companions/README.md#companion-promotion).
3. <a id="runtime-side-artifact"></a>**Runtime side artifact** (`build-runtime-binaries.ts`). Reads
   multiples.tsv + `catalog-row-index-map.json` (whose `bySynth` section
   sits alongside `byGaia` / `byHip`), emits `public/binaries.bin` — one
   fixed-size record per physical pair carrying Kepler elements + sep/PA
   + a hierarchical parent-relation index, in the layout
   `/src/catalog-format/binaries/` owns. It refuses to emit when the map's
   `multiplesSha1` is not the `multiples.tsv` it reads (a catalogue built
   from another copy). Each end resolves through
   `catalog-row-index-map-pure.ts` (`../catalog/companions/record-index/`),
   the functions the catalogue's wings pass calls too:
   gaia → hip → synth; the synth key composes from the pair's expanded
   `comp` tokens (`Aa1,2` resolves through the same `synth-…-Aa2` key the
   catalog minted). Both pair ends then prefer a distinct synth slot over
   their id-first resolve: promotion mints a synth record only after
   judging a row's ids inherited and stripping them, so when one exists
   it is always the truer target than the blended member row the
   inherited id lands on. `pnpm run build:binaries-runtime`; loaded by
   `src/client/binaries/binaries-loader.ts`.

The Tier A validation harness
(`scripts/catalog/validate/known-stars.test.ts`) reads multiples.tsv
directly for per-component sanity checks (SIMBAD spectral type,
absmag-from-Δmag).

Build-time statistics for every step land in snapshot JSONs, each
gating the step's emission; `--update-snapshots` refreshes them.

## Shared slots and duplicate relations

An inner pair's primary
must resolve to its parent component's catalog slot — the shared-slot
invariant the runtime walk + focal-frame ride depend on (see
[Hierarchical walk](/src/client/binaries/README.md#hierarchical-walk)). When a sibling
shares its identifier with the system primary (Castor A & B blend to one
Gaia source; A & B of 02398-4254 share a HIP Gaia later split), the inner
pair's own id-first resolve lands on the wrong sibling. Two coupled
corrections in `runtime-binaries-pure.ts`: `assignParentRelations`
picks the *bound* parent (has-orbit, then tightest sep) over a
coincidental element-less wide pair, and `overrideInnerPrimaryIndices`
re-homes each inner pair's primary onto that parent's member slot.
`companion-promotion.ts`'s post-pass makes the baked catalog placement
agree (see [Companion promotion](/scripts/catalog/companions/README.md#companion-promotion)).

A blended primary the synth re-home can't reach (its component was dropped
by promotion, or it's a compound / secondary-side collapse) still resolves
onto the anchor, producing a duplicate `(primary, secondary)`. `planRecords`
emits one record per relation, and when duplicates collide it keeps the
orbit-bearing member (`hasRenderableOrbit`; ties keep first in walk order) so the
system's live motion survives the dedup rather than an element-less wide
pair winning by walk position. Each drop is classified
(`sameRelationAlias`): when on each side the two pairs' canonical comp
tokens are equal, hierarchy-related, or compound-contained, the two rows
name the SAME physical link at different granularity (18025+4414 `AB` vs
`Aa,B`) — a correct, permanent dedup counted
`pairs_dropped_same_relation_alias`. Disjoint letters on either side mean
two DISTINCT stars collapsed onto one record; those are counted
`pairs_dropped_duplicate_relation`, a ratchet toward zero — each is a
missing minted slot (current floor: θ¹ Ori's `Bb,Bc` / `Bb,Bd`, whose
Ba/Bb sub-letter blend the inner-pair hierarchy owns).
