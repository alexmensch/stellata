# Constellation-boundary artifact — build stage

`build-boundaries-artifact.ts` sweeps the shipped star population for fade
samples and renders `public/constellation-boundaries.json`. Called from
`../build-catalog.ts`, which hands it the lookup ([Cost](#cost)) and writes
the result with its other outputs. The wire shape, the quantisation and the
fade statistics it fills are the artifact's contract with the viewer:
[`/src/catalog-format/boundaries/`](/src/catalog-format/boundaries/README.md).
`boundaries-region-grid.test.ts` round-trips the real region grid —
decomposed from the edge set `../parse/constellations/` parses — through
that contract's run-length codec.

## Cost

The sweep is one nearest-wall query per shipped record — ~390k against <!-- count:build-catalog/boundarySegments -->781<!-- /count -->
arcs. The linear scan (`angularDistanceToNearestEdgeDeg`) would be a
quarter-billion arc evaluations and minutes of build time, so
`createIauConstellationLookup` routes through `createNearestEdgeIndex`,
which prunes on a declination-band lower bound. Exact, not approximate,
and pinned against the linear scan across a sphere-wide sampling grid.
The whole stage costs under a second.

`renderBoundaryArtifact` takes the lookup rather than building one, and
passes it whole to `buildBoundaryArtifact`: `loadReadStarsInputs` already
decomposed the edge set for byte 34 ([Positional constellation membership](../parse/constellations/README.md#positional-constellation-membership)),
so the arcs, the label anchors and the shipped
grid are three readings of that one decomposition — none of them can
disagree with the membership the catalogue shipped.
