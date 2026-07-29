# Constellation-boundary artifact

`public/constellation-boundaries.json` — the IAU (Delporte 1930) boundary
arcs resampled and precessed into ICRS, plus the magnitude-keyed
fade-quantile table the chart-mode layer picks its fade window from. Runs
as a stage of `build:catalog`.

The geometry lives in
`src/client/constellation-boundaries/README.md`; this folder owns the wire
shape, the quantisation, and the statistics.

## Files in this area

```
scripts/catalog/boundaries/
  boundaries-artifact-pure.ts     Wire shape, direction quantisation, the
    (+ test)                      misplacement-offset formula, and the fade
                                  quantiles. Pure.
  build-boundaries-artifact.ts    Reads the edge records, sweeps the shipped
                                  star population for fade samples, writes
                                  the JSON. Called from ../build-catalog.ts.
```

## Wire shape

```
{ epoch: "B1875", frame: "ICRS", stepDeg: 0.5,
  segments: [ { k: "M"|"P", c: ["DEL","AQL"], d: [x,y,z, x,y,z, …] }, … ],
  fade: { magLimits, quantilePcts, offsetsPc, sampleCounts } }
```

**`epoch` and `frame` are different things** and conflating them is the
one failure mode worth guarding: the arcs are *drawn* at equinox B1875,
the directions are *emitted* in ICRS. Both are stated so a consumer can't
assume the samples still sit at constant RA / Dec.

`d` is flat x,y,z triples in arc order, quantised to
`DIRECTION_DECIMALS = 7` — 1e-7 rad ≈ 0.02″, two orders under the
arcsecond the round-trip test holds, and roughly half the bytes of full
float64. 781 arcs → ~10.1k directions → ~335 KB (`boundarySegments` /
`boundaryDirections` / `boundaryArtifactBytes` in build-counts; nowhere
near the 25 MiB Workers asset limit, so no chunking).

`c` carries the two constellations the arc separates, in source order,
which carries **no side convention** — see the geometry README.

## Subdivision is load-bearing

Each arc is resampled at `POLYLINE_MAX_STEP_DEG = 0.5` before precession.
That is not a smoothness nicety:

- A **constant-Dec** arc is a SMALL circle in B1875. Precession maps it to
  neither a straight line nor a great-circle arc, so a two-endpoint
  parallel draws a chord cutting **more than a degree** inside the true
  boundary. `iau-boundaries-pure.test.ts` pins that departure so a future
  "we only need the endpoints" optimisation fails rather than quietly
  moving the boundaries.
- A **constant-RA** arc *is* a great circle and precession is a pure
  rotation, so two endpoints would survive. They subdivide anyway: one
  code path, one uniform tessellation. The contrast is pinned too — a
  meridian's samples stay coplanar to 1e-12.

Each edge record names both its neighbours and appears exactly once, so
the flat segment list is already deduped. **Do not build
per-constellation polygons**: every shared arc would then ship twice.

## Fade table

A drawn boundary is a pure Sol-frame projection with no 3D referent, so it
has to fade out as the camera leaves Sol. The window is derived, not
taste-picked: per star,

```
offsetPc = (angular distance to its nearest wall + 0.5°) × distance from Sol
```

is the camera offset at which that star becomes visibly misplaced
relative to its own cell. `offsetsPc[i][j]` is the `quantilePcts[j]`
percentile of that over every star with apparent V ≤ `magLimits[i]`, so
the runtime lerps a window out of the live magnitude slider.

Rows are emitted only where ≥ `FADE_MIN_SAMPLES` (64) stars qualify — a
percentile over a handful of naked-eye stars is sampling noise — and the
build fails if fewer than two rows survive, since one row is a constant
the slider cannot move. The runtime clamps outside the emitted range.
`sampleCounts` ships alongside so a thin row is visible rather than
implied.

The numbers are small on purpose: at V ≤ 6.5 the 5% quantile is under a
parsec. The nearest bright stars have enormous parallax — from α Cen,
Sirius shifts ~30° — so the boundaries are a Sol-neighbourhood affordance
that must self-hide before the first star. That is the correct outcome:
from another star, Earth's constellation boundaries do not describe the
sky.

## Cost

The sweep is one nearest-wall query per shipped record — ~330k against 781
arcs. The linear scan (`angularDistanceToNearestEdgeDeg`) would be a
quarter-billion arc evaluations and minutes of build time, so
`createIauConstellationLookup` routes through `createNearestEdgeIndex`,
which prunes on a declination-band lower bound. Exact, not approximate,
and pinned against the linear scan across a sphere-wide sampling grid.
The whole stage costs under a second.
