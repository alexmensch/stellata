# Integration tests — the pipeline and the viewer read together

Tests that need both sides at once: a pipeline output read back through
the viewer's decoder, a Python baker held to the viewer's TypeScript mirror,
a viewer calibration run against the pipeline's source data. Neither
`src/client/` nor `scripts/` may import the other, tests included
([Pipeline-viewer boundary](../README.md#pipeline-viewer-boundary)), so a
test that must is here, where any import is allowed. Nothing outside this
folder imports from it.

Each file is named as it was beside the code it pins; the folder READMEs
that describe those pins point here by path.

- **Pipeline output through the viewer**: `binaries-bin-golden` (the
  encoder against the loader), `cloud-surfaces`, `blackbody-lut` (the
  generated LUT against the chain), `multi-star-regression`,
  `sky-position`, `phys-size-elision-catalog`,
  `constellation-boundaries`, `constellation-regions`.
- **Bakers against the viewer's mirrors**: `dem-relief`, `horizon-map`,
  `sky-view`, `ring-strips`, `texture-colours` (each reads its Python
  baker from `/scripts/textures/`).
- **Viewer layers against pipeline sources**: `milkyway`,
  `local-group-emission`, `local-group-emission-calibration`, `lg-peak-pure`
  and their `lg-catalog-fixture.ts` (the shipped Local Group assembled from
  `data/` by the build's own code), `sol-object-sids` and
  `shell-object-sids` (runtime SID pins against the ledger).

`milkyway-sightlines-expected.json` holds every figure `milkyway.test.ts`
measures that the Milky Way calibration docs quote: the test pins it
through `figurePins`, the docs through doc-figure markers
([Measured figures](/scripts/doc-figures/README.md#measured-figures--a-tests-pins-as-a-snapshot)).
A re-measure that moves one fails the suite until
`UPDATE_SNAPSHOTS=1 pnpm vitest run tests/integration/milkyway.test.ts`
and `pnpm run docs:figures` regenerate both.
