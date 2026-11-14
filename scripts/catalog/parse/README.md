# Per-row pipeline and reference-catalogue parsing

The membership-manifest row walk (`readStars` in `stars-parse.ts`) and
everything it resolves per star: space-motion velocity and the GCVS
variability cross-match. Constellation membership and the stick figures are
`constellations/`. Spectral class and physical radius
are resolved here but owned by `../spectral/`. The binary record layout these
fields land in is [Binary catalog format](../../../src/catalog-format/record/README.md#binary-catalog-format-publiccatalogbini--manifest); the
membership term
it walks is `../membership/README.md`.

## Files in this area

```
scripts/catalog/parse/
  stars-parse.ts (+ test)         readStars — the per-row pipeline, a map of
                                  the resolver rowResolver builds over the
                                  manifest plus a fold. The resolver reads
                                  nothing but its row: one row to a
                                  RowOutcome, parked or shipped with its
                                  provenance. The hub every other subfolder
                                  imports.
  walk-stats-pure.ts (+ test)     walkStatsFold — the walk's counts, folded
                                  from each RowOutcome as it passes, so no
                                  outcome outlives its row.
  read-stars-inputs.ts            loadReadStarsInputs — every reference
                                  table readStars consumes, each read through
                                  its declared source (../../util/sources/),
                                  so a missing one fails the build. One loader is
                                  a derived index rather than a file read: the
                                  bound-sibling parallaxes the distance
                                  cascade's bottom tier lends, which cross
                                  multiples.tsv with the Gaia table already
                                  loaded here. Async, because the 5p tier has
                                  a second source once the magnitude term is
                                  on (README.md#the-direction-tiers-two-gaia-files).
                                  Its InputsCounts, each table's size, is
                                  the snapshot's inputs count block.
  gaia-hip-xmatch-source.ts       GAIA_HIP_XMATCH / GAIA_TYC_XMATCH, the two
  gaia-tyc-xmatch-source.ts       cross-walks declared one per module, so a
                                  step reaches only the one it reads. The HIP
                                  walk keys classic-ID lineage's HIP rows
                                  (`gaia-dr3-hip:<hip>`).
  gaia-xmatch.ts (+ test)         Gaia DR3 best-neighbour cross-walk parsing
                                  (HIP + TYC, one shared accumulator). The HIP
                                  walk now serves the GCVS byGaia bridge in
                                  build-catalog.ts, not the record walk. The
                                  TYC reader streams and takes a keep-set —
                                  its table is 2.5 M rows. The binaries
                                  pipeline's Stage 1 reads both walks too.
  gcvs/                           GCVS variable-star parsing and the
                                  variability cross-match, with its own
                                  README. Read by build-catalog only.
  constellations/                 The IAU-88 table, byte 34's positional
                                  membership and the Stellarium stick
                                  figures, with its own README.
  corpus-tsv.ts                   Record-ref parsing for the frozen regression
                                  corpora (known-stars.tsv,
                                  multi-star-regression.tsv,
                                  system-pair-topology.tsv). RECORD_REF_KINDS
                                  is the one list of ways a corpus row
                                  addresses a record — hip / gaia / name / hd.
  star-fixture.ts                 Test-only star-record builder.
```

## TSV header resolution

Every external table the build reads — every pull, every frozen catalogue,
every hand-curated file — resolves its header and parses its cells through
`readTable` / `tableLineReader` (`../../util/tsv/table-pure.ts`, its own
README), over a `TableSpec` naming the repo-relative file, the columns the
reader needs and the refresh hint. A file this repo writes goes through its
artifact codec instead.

**It throws on a missing column AND on an empty or headerless file.** Every
input is a committed, usually LFS-tracked artifact, so zero rows means
truncated or unsmudged, never an empty dataset — a parser answering with an
empty map turns a missing file into a silently zeroed join that only surfaces
as a count drift much later. A valid header with no data rows is a different
thing and legitimately yields no rows.

Two deliberate departures:

- `gaia-xmatch.ts`'s whole-text parser feeds its line-fed accumulator rather
  than `readTable`; the accumulator's result calls the reader's `finish()`, so
  an empty file still fails as having no header row.
- A file this repo writes is read through its `defineArtifact` codec
  (`../../util/tsv/README.md#artifact-codecs`) — the manifest's
  `MEMBERSHIP_MANIFEST`, the spine's `INHERITED_SPINE` and the rest — which
  demands the header be its column list **byte for byte, in order** and every
  row carry exactly that many cells, where `readTable` resolves columns by
  name in any order. A header that merely parses is a file nobody meant to
  ship.

`parseSimbadSptypeTsv` (`../spectral/spectral-resolve.ts`) requires all eight
columns it reads, `hip` / `tyc` / `gj` / `sp_qual` / `otype` included, and
`simbad_oid`, the row key a spectral answer's lineage cites. Four of
those ARE the SIMBAD ladder's designation tiers, so an optional one vanishing
from a re-pull would zero a tier silently and surface only as a count drift in
`../build-catalog-expected.json`; required, it fails at the read with the
pull's refresh hint.

## Streaming a committed table

Three tables are too large to hold as one string: the 2.5 M-row TYC
cross-walk, the ~200 MB magnitude pull, and the manifest once the magnitude
term is on. Each is read through its source's `input.lines` (or `streamArtifact`,
`../../util/sources/`) feeding a
**line-fed accumulator** — a `{ line, result }` pair whose `line` resolves the
header on first call and folds every row after it.

The accumulator is what makes the streaming real. A reader that collects
matching lines and re-joins them for a whole-text parser holds the subset
three times over — the array, the joined string, and the parser's own split —
which is the cost streaming was reached for. Writing one means the whole-text
entry point folds rows through the same function — `readTable` feeding it
where the accumulator's `line` is a `tableLineReader` — so the two paths
cannot diverge on what a row means:
`bestNeighbourAccumulator` (`gaia-xmatch.ts`),
`gaiaAstrometryAccumulator` (`../sources/gaia-astrometry-source.ts`),
`magnitudeTermAccumulator` (`../membership/magnitude-term/`) and
`MEMBERSHIP_MANIFEST.lineReader` (`../membership/membership-manifest-tsv.ts`) are the
four, each paired with its whole-text sibling.

An accumulator that takes a **keep-set** filters during the fold rather than
after it, so a subset join never materialises the table.

## The direction tier's two Gaia files

`directions.gaiaAstrometry` is fed by `gaia_dr3_astrometry_catalog.tsv` and,
when `MAGNITUDE_FLOOR_V` is set, by the magnitude pull's own rows for the
sources that term admitted — same schema, same parser, so tier 1 sees one kind
of row and cannot tell which file it came from. Only the manifest rows marked
`term=magnitude` are read out of the pull, and a source the catalogue file
already answers for keeps that row. Both passes stream ([Streaming a
committed table](#streaming-a-committed-table)): the keep-set folds out of the manifest a line at a time, and
the pull's rows are filtered against it during the fold rather than collected
and re-parsed. With the floor off, neither read happens.
[The astrometry comes with it](../membership/magnitude-term/README.md#the-astrometry-comes-with-it).

## Per-row pipeline

Each manifest row walks through, inside `readStars`. The row arrives with its
`gaia_source_id` already resolved and justified — [The identifier columns are read, never re-derived](../membership/README.md#the-identifier-columns-are-read-never-re-derived)
— and with its classic-ID
labels already FINAL, so no label merge runs here (`../classic-ids/README.md`
label-merge/README.md).

**A row leaves without a record only by parking.** A **park** (steps 0, 1
and 2) is a membership decision: the row reaches no parallax, no V, or no
position, so the [§ 6.1](/docs/catalog-driver.md#61-record-parity) ledger records it leaving and
`data/membership/parked-ledger.tsv` names it. Parks are pinned at their
measured counts, one `placement.park.*` code per reason. A row past
the step-5 cutoff is a reference table disagreeing with the tiers above it —
never a membership decision — so the walk throws, naming the row.

0. **Parallax resolution** (`resolveParallax` in `../distance/parallax/`).
   Every tier is a catalogue this build pulled itself. A row no tier reaches
   **parks** — `no_parallax_published`, or `refused_no_defensible_parallax`
   where a parallax existed but no tier would defend it.
1. **Johnson V** (`resolveVMagnitude`). See [The V cascade](../photometry/README.md#the-v-cascade).
   A row no tier lights **parks** as `no_v_magnitude`: a record needs
   both a place and a brightness. The tier that won is kept on the record as
   `vVia`, because it decides whether the magnitude is the system's blend or
   one component's — companion promotion's flux conservation may only subtract
   a companion's light from a blend ([Anchor flux conservation](../companions/README.md#anchor-flux-conservation-post-pass)).
2. **Direction resolution** (`resolveDirection` in `direction-cascade.ts`)
   selects the tier's solution. See [Direction resolution](../distance/README.md#direction-resolution).
   Every solution propagates rather than shipping its source's own
   epoch, so a row no tier reaches resolves to `none` and **parks** as
   `no_position`: a distance with no direction has nothing to multiply. **One
   row**, HIP 88759 — a HIP-only addition a bound sibling's parallax placed and
   printed HIP photometry lit, for which SIMBAD resolves no object at all, so
   the coordinate tier has nothing to serve it either. Every other row of that
   shape reaches SIMBAD coordinates ([The values pull](/data/simbad/README.md#the-values-pull)).
3. **Proper-motion rescue** (`resolvePmRescue`), where the direction tier
   states a position but no motion. See [Space-motion velocity](../distance/README.md#space-motion-velocity).
4. **Distance overrides**, in order, each superseding the last on the rows it
   claims. `dist = 1000/plx` from step 0, then
   **[Bailer-Jones 2021](/data/papers/index.md#bailerjones2021) (DR3)**
   (`applyBailerJonesOverride`), eligible where step 0 resolved
   `gaia_dr3_inversion` — the posterior treats that measurement, so a non-Gaia
   parallax must not be regressed onto its Galactic-density prior — then the
   **LMC kinematic override** (`applyLmcKinematicOverride`), which gates on the
   direction tier's own place, the motion steps 2–3 settled, and step 0's
   parallax with its error. See
   [Multi-layer distance refinement](../distance/refinement/README.md#multi-layer-distance-refinement).
5. **`MAX_DIST_PC = 50_000` bounded-scope cutoff** (`stars-parse.ts`). A
   row still beyond LMC depth after every override **fails the walk**.
6. **absmag** — astro-core's `absoluteMagnitude` on step 1's V and the distance
   the whole override stack settled; **position** — `directionOnPm` advances
   the step-2 solution to the scene epoch on the motion the row ends up
   carrying, and `xyz = direction × distance` in float64; then **velocity**
   assembly ([Space-motion velocity](../distance/README.md#space-motion-velocity)).
7. **Spectral classification** (`resolveSpectralInfo`; Sol's G2V is its
   curated record's — no HIP/Gaia/SIMBAD key reaches it). See
   `../spectral/README.md`.
8. **B−V** (`resolveColourIndex`) — the Gaia relation, else printed
   `I/239` B−V, else Gaia's synthetic B−V, else the intrinsic
   spectral-class colour, else `none`, which bakes solar. See
   [The ci cascade](../photometry/README.md#the-ci-cascade). `ciIsObserved` on
   the tier is what decides whether de-extinction de-reddens the value, so the
   three measured tiers and the two intrinsic outcomes part company here
   rather than at the dust integral.
9. **Physical radius** (`physicalRadius`). Stefan-Boltzmann from absmag
   and the resolved Teff — the measured Apsis Teff (gspphot → gspspec
   via `resolveApsisTeff`, 2–60 kK sanity window) when present, else
   the class-table value; BC always class-table. White dwarfs
   special-cased to 0.013 R☉; Wolf-Rayets keep their own ramps (Apsis
   models neither). Clamped to [0.08, 2500] R☉. It returns the route it took
   ([The radius chain](../../../src/catalog-format/spectral/README.md#the-radius-chain)),
   which the size stage writes.
10. **Constellation** — positional, from the resolved xyz
    ([Positional constellation membership](constellations/README.md#positional-constellation-membership)). Nothing here sets the
    DESIGNATION's constellation: the manifest carries no editorial `con` cell.

The walk's counts are its stages' lines folded per code: placement's
([Placement counts](../distance/README.md#placement-counts)) and
brightness-colour's
([Brightness-colour lineage](../photometry/README.md#brightness-colour-lineage)).
`walk-stats-pure.ts` folds the rest from each `RowOutcome` as it passes: the
parked list promotion reads, placement-derived's shipped tiers, and the
build log's velocity samples. A parked row writes no step past its park, so
it is in no shipped tier and no radial-velocity code.

`plxDistPc` / `plxVia` are build-time-only, like `vVia`: step 0's own inversion
and the tier that supplied it, captured before any override layer fires so the
post-build distance-regression check has the input to measure drift against.
Both are null on Sol, which sits at distance zero by construction, and on
records minted rather than walked. `originKey` is build-time-only too: the
row's `origin_key`, which a later stage's lineage cites the record by
([Identity](../lineage/README.md#identity--the-origin-source-row)). Beside
the records the walk hands `readStars`' `onRow` each row's outcome, parked or
shipped — its `Placement`, its `BrightnessColour` wherever the row reached
V, and a shipped record's `Size` — and keeps none of them: the caller turns
each into what [placement lineage](../distance/README.md#placement-lineage),
[brightness-colour lineage](../photometry/README.md#brightness-colour-lineage)
and [size lineage](../spectral/README.md#size-lineage) write.

The manifest carries no `x0/y0/z0`, and AT-HYG's was never consumed: it is a
mixed-epoch merge artifact, tabulated at ~3 dp (a 206 AU grid) and internally
inconsistent with the same row's printed ra/dec by up to tens of arcsec on
high-PM stars ([Driver astrometry](/docs/science-catalog-ingestion.md#driver-astrometry--at-hyg-precision-findings-and-the-direct-sourcing-decision)).

**Sol walks the same steps as every row.** Its curated record
([Curated records](../record/README.md#curated-records)) supplies the
`curated` tier of parallax, V, direction and spectral class; its placement is
the origin, which is what zeroes its velocity, skips the PM rescue and
leaves its constellation unclassified. `readStars` reads `isSol` only to set
`FLAG_IS_SOL`.

## Space-motion velocity

Each record's `vx/vy/vz` is assembled after its direction resolves, by
`velocityPcPerYr` in `../distance/`:
[Space-motion velocity](../distance/README.md#space-motion-velocity).

After the per-row pass: GCVS cross-match (`bridgeGcvsByGaia`), CCDM
visual-doubles flagging (`visual-doubles.ts`), and the 100-byte v9
record write per star including the seven `float32` Apsis fields, the
`uint32` `sid`, the three `float32` velocity components, plus the
`uint8` multiplicity status. See sections
below.
