# Stage 1 — the reference catalogues, loaded

The TypeScript Stage 1 of the binaries pipeline: every reference catalogue
read through its declaration ([Declaring a source](../../util/sources/README.md#declaring-a-source)),
then the Stage 1 passes over them, returned as one frozen `ReferenceCatalogs`
for Stage 2 to resolve. `../build-binaries.ts` calls it; until the switch,
`build:binaries` runs `../build-binaries.py` and only tests call this
([Porting to TypeScript](../README.md#porting-to-typescript--one-stack-one-switch)).
What each pass decides, and why, is the parent README's
([Sub-pair synthesis](../README.md#sub-pair-synthesis-subdividepy),
[Blank-components rescue](../README.md#blank-components-rescue-stage-12-boundary),
the magnitude gate under [Stage 2](../README.md#stage-2--wds-component--gaia-dr3-source_id)).

## Files in this area

```
scripts/binaries/load/
  reference-catalogs.ts        loadReferenceCatalogs (the reads) and
                               assembleReferenceCatalogs (the passes, pure),
                               ReferenceCatalogs, ROW_BANDS, stage1Counts.
  assemble.test.ts             The passes over fixtures: order, outcomes,
                               counts, bands.
  stage1-report-pure.ts        The build-log lines, read off the result;
                               the AT-HYG Gaia-coverage warning band.
  msc-pure.ts (+ test)         The MSC tables, the label → WDS token map,
                               the MscLookup, and the MSC element checks
                               (period, t0, renderable).
  msc-source.ts                MSC_SYSTEMS, MSC_ORBITS, MSC_COMPONENTS.
  curated-pure.ts              The three hand-curated tables.
  curated-source.ts            ORB6_COMPONENT_OVERRIDES,
                               COMPONENT_SPTYPE_OVERRIDES,
                               ASTROMETRY_EXCLUSIONS.
  gaia-pure.ts                 The 5p astrometry pull and the NSS orbit
                               columns.
  binaries-astrometry-source.ts  BINARIES_ASTROMETRY (gaia_dr3_astrometry.tsv).
  simbad-pure.ts               SIMBAD's WDS cross-IDs, the sp_type pull, and
                               their join on simbad_oid.
  simbad-wds-sptype-source.ts  SIMBAD_WDS_SPTYPE.
  athyg-pure.ts                The AT-HYG rows, off ATHYG_CLASSIC_IDS.
  readers-pure.test.ts         The curated, Gaia, SIMBAD, AT-HYG and MSC
                               readers.
  indices-pure.ts (+ test)     IdentifierIndices, the CCDM index, and the
                               magnitude gate (scrubAthygGaia, and the HIP
                               cross-walk's inside buildIndices).
  subdivide-pure.ts (+ test)   The curated ORB6 letters, the ORB6 orphan
                               pairs, the MSC inner pairs; subResolutionPair,
                               the row every synthesized pair is, Stage 3's
                               NSS inner pairs included.
  blank-rescue-pure.ts         The blank-components rescue.
    (+ test)
  load-fixture.ts              Test-only row builders (the WDS and ORB6
                               ones are ../../wds/wds-fixture.ts).
```

The real-data case is the parent folder's `build-binaries.test.ts`.

## Where each input comes from

Seventeen inputs. Eight are declared here. The WDS summary and ORB6 are
declared in [`../../wds/`](../../wds/README.md), which the SIMBAD WDS cross-ID
pull reads too, with the duplicate-row collapse and `measuredOffset`. Seven are files the catalogue build
reads too, read through **its** declaration, never a second one: AT-HYG
(`../../catalog/spine/`), HIP↔CCDM (`../../catalog/multiplicity/`), HIP2 and
the NSS table (`../../catalog/sources/`), the two Gaia best-neighbour walks
(`../../catalog/parse/`), and SIMBAD's WDS cross-IDs
(`../../catalog/membership/binding/`). Where the two builds want different
columns of one file, the declaration returns a column table and each reader
keeps its own parse ([Reading a table](../../util/tsv/README.md#reading-a-table)).

## The order of the passes

`assembleReferenceCatalogs` runs them in the Python shell's order, because
each reads the one before:

1. Collapse duplicate WDS rows; stamp the curated ORB6 letters.
2. Synthesize the ORB6 orphan pairs, from the curated ORB6.
3. Drop the curated astrometry exclusions, then the magnitude gate empties
   refused AT-HYG `gaia` cells; the indices are built from the scrubbed rows.
4. Rescue blank-components rows, over the WDS rows and the orphans (an orphan's
   donor row is not rescued), and align blank ORB6 rows to AB.
5. Synthesize the MSC inner pairs, which see the rescued AB rows.

`pairs` is the WDS rows, then the orphans, then the MSC inner pairs — the
list Stage 2 walks.

## How the readers read

The cell rules are the one reader's
([Reading a table](../../util/tsv/README.md#reading-a-table)): a missing
column throws, an empty cell is absent, and a non-empty cell that does not
parse throws, naming file, line and column. The fixed-width WDS and ORB6
fields read the same way, plus their own sentinels
([How the readers read](../../wds/README.md#how-the-readers-read)). A row that is a rejected archive record or carries no key is
skipped: a Gaia astrometry row with no position or epoch, an AT-HYG row with
no position, distance or absolute magnitude, a SIMBAD cross-ID with no
wds_id, component or oid. A curated row missing a cell it exists to state
throws ([Cell corrections](../../util/tsv/README.md#cell-corrections)).
AT-HYG spells an absent identifier `0` as well as empty.

## Checks and counts

`checks` are the row-band checks (`ROW_BANDS`, the pull runtime's
`bandCheck`), which the shell hands to `emitArtifacts` once it writes
multiples.tsv, so a truncated input fails before any write. An ORB6 row whose
grade cell is not a digit reads as grade 5 (outcome `fallback`).

Each pass returns one outcome per row it weighed — duplicate collapse, ORB6
grades, curated ORB6 letters, astrometry exclusions, the rescue, MSC synthesis
— and every count, in `stage1Counts` and in the build log, folds from those
through the one tally helper ([The tally](../../util/counts/README.md#the-tally));
no pass returns a bare number.
`stage1Counts` names the count-snapshot keys this stage's code produces. The
snapshot's `wds_pairs_total` is not one of them: Stage 3 appends its NSS
inner pairs to the same list, so its `stage3Counts` returns the total
([Counts](../astrometry/README.md#counts)).
