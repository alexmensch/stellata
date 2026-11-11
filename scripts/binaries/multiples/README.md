# Stage 6 — multiples.tsv records, in TypeScript

The TypeScript Stage 6 of the binaries pipeline: every pair Stage 5 kept
(`../optical/`) becomes two `MultiplesRecord`s, the shape `../multiples-tsv.ts`
encodes, then each SIMBAD-known component no kept pair reached becomes one
standalone record. `../build-binaries.ts` calls it; until the switch,
`build:binaries` runs `../build-binaries.py` and only tests call this
([Porting to TypeScript](../README.md#porting-to-typescript--one-stack-one-switch)).
What each column carries, the anchor offsets and the backstops, and why, is the
parent README's ([Stage 6](../README.md#stage-6--multiplestsv-emit)).

## Files in this area

```
scripts/binaries/multiples/
  attach-multiples.ts (+ test)      attachStage6 (the pair walk, then the
                                    standalone sweep), Stage6Result,
                                    stage6Counts.
  multiples-rows-pure.ts (+ test)   positionPc (a position at the scene
                                    epoch), pairRows, standaloneRow,
                                    orbitFields (q backfill and the
                                    estimated-element backstops),
                                    wdsYearToJd.
  anchor-offsets-pure.ts (+ test)   computeAnchorOffsets: each system's
                                    anchor letter and every reached
                                    component's offset from it;
                                    photocentreOffsets.
  gaia-photometry-pure.ts (+ test)  gaiaPhotometryAbsmagCi: M_V and B−V from
                                    a component's own Gaia row.
  pair-photometry-pure.ts (+ test)  pairMagnitudes (WDS's, else the MSC's)
                                    and wdsDmag.
  stage6-report-pure.ts             The build-log lines, read off the result.
  stage6-fixture.ts                 Test-only: runStage6 over hand-built
                                    pairs.
```

## The shape of a result

`Stage6Result.rows` is the file's row order: two rows per kept, placed pair in
Stage 3's pair order, then the standalone rows in the SIMBAD cross-ID file's
order. A kept pair with no position on either side and no system anchor is not
a row; its `<wds_id><components>` is in `droppedNoPosition`, the only record of
it. `mscMagFills` names the pairs whose magnitudes came from the MSC.

Each record is built whole, never patched: `pairRows` composes the two
components' own fields, the fields the pair shares (orbit, q, the backstops,
WDS geometry and magnitudes) and each side's anchor offset.

## System-inherited positions

A component with no position of its own takes its system's: the first measured
position among the system's pairs in pair order, primary before secondary
(`firstPerSystem`, [System anchors](../astrometry/README.md#system-anchors)),
and is tagged `system_inherited`. Every position is advanced to
`CATALOG_SCENE_EPOCH` (`/src/catalog-format/record/catalog-pure.ts`) before it
is written or chosen as an anchor.

## Gaia photometry

A component with no AT-HYG row but its own Gaia 5p fit takes M_V and B−V from
that Gaia row (`gaia_photometry`), unless the pair partner carries an AT-HYG
row and the same source: Stage 2 copied the partner's blended source onto this
side, and the partner already carries the system's light.

The route is the Python's, ported unchanged: B−V through the Teff of
[Montalto 2021](/data/papers/index.md#montalto2021), fed the observed rather
than the de-reddened colour, and the inverse of
[Ballesteros 2012](/data/papers/index.md#ballesteros2012); V through Riello's
G − V with BP − RP clamped into its range where the catalogue's
`rielloVMagnitude` refuses. Neither is the catalogue's published DR3 transform
(`/scripts/catalog/photometry/colour-index-pure.ts`), and the two disagree on
most rows; adopting the catalogue's is `stellata-hooj.43.1`, after the switch.

## Counts

`stage6Counts` returns the `multiples` stage's keys of
`../build-binaries-expected.json`, each folded through the one tally helper
(`/scripts/util/counts/tally-pure.ts`); a populated count is the `populated`
bucket of a two-variant fold. `../build-binaries.test.ts` holds them to the
committed snapshot.

## Byte identity with the Python stage

The records encode byte-identical to the committed `multiples.tsv`. Three
places do Python's float arithmetic rather than JavaScript's
(`../python-float-pure.ts`): the photocentre's weighted sums are `pySum`,
Python 3.12+'s compensated `sum()`; the anchor position angle wraps through
`pyMod`; and the photocentre walk visits neighbours in token order, as the
Python sorts them.
