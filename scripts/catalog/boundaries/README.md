# Constellation-boundary artifact

`public/constellation-boundaries.json` — the IAU (Delporte 1930) boundary
arcs resampled and precessed into ICRS, the per-region label anchors, the
resolved cell grid the runtime resolves membership against, and the
magnitude-keyed fade-quantile table the chart-mode layer picks its fade
window from. Runs as a stage of `build:catalog`.

The geometry lives in
`src/client/constellation-boundaries/README.md`; this folder owns the wire
shape, the quantisation, and the statistics.

## Files in this area

```
scripts/catalog/boundaries/
  boundaries-artifact-pure.ts     Wire shape, direction quantisation, the
    (+ test)                      region-grid run-length codec, the
                                  misplacement-offset formula, and the fade
                                  quantiles. Pure.
  build-boundaries-artifact.ts    Sweeps the shipped star population for fade
                                  samples and writes the JSON. Called from
                                  ../build-catalog.ts, which hands it the
                                  lookup (§ Cost).
  boundary-artifact-fixture.ts    Test-only: the smallest artifact that clears
                                  the load-time validator.
```

## Wire shape

```
{ epoch: "B1875", frame: "ICRS", stepDeg: 0.5,
  segments: [ { k: "M"|"P", c: ["DEL","AQL"], d: [x,y,z, x,y,z, …] }, … ],
  labels:   [ { c: "SER1", d: [x,y,z], a: 428.48 }, … ],
  regions:  { raDeg, decDeg, codes, runs },
  fade: { magLimits, quantilePcts, offsetsPc, sampleCounts } }
```

**`epoch` and `frame` are different things** and conflating them is the
one failure mode worth guarding: the arcs are *drawn* at equinox B1875,
the directions are *emitted* in ICRS. Both are stated so a consumer can't
assume the samples still sit at constant RA / Dec.

`d` is flat x,y,z triples in arc order, quantised to
`DIRECTION_DECIMALS = 7` — 1e-7 rad ≈ 0.02″, two orders under the
arcsecond the round-trip test holds, and roughly half the bytes of full
float64. 781 arcs → ~10.1k directions, and with the labels and the region
grid the whole file is ~359 KiB (`boundarySegments` /
`boundaryDirections` / `boundaryRegionRuns` / `boundaryArtifactKb` in
build-counts; nowhere near the 25 MiB Workers asset limit, so no
chunking).

**Every geometry number in the file is rounded, and the size is pinned in
KiB, not bytes.** The artifact is ~30k decimal-formatted floats, so its
byte length is a function of the last digit of every one of them — and
V8's trig differs in the last bit across Node versions and architectures
(local dev runs Node 26 / arm64, CI Node 24 / x64). An exact byte pin
therefore fails on a difference that changes nothing: it drifted
343047 → 343049 between the two. KiB keeps the signal the pin exists for —
dropping `DIRECTION_DECIMALS` by one moves ~30k values a character each,
~30 KiB — while ignoring last-digit noise.

The rounding is not a wide moat: 367,647 bytes sits ~450 bytes below the
359/360 KiB edge, because `Number(v.toFixed(7))` strips trailing zeros
and ~16.6k of the 30k geometry values are therefore shorter than full
width. That absorbs the last-digit drift this replaced with ~200×
headroom, but a genuine wire change (a new field, a different step) will
move the pin by a KiB or more — which is the point. A ±1 KiB flip means
re-pin, not bug.

`c` carries the two constellations the arc separates, in source order,
which carries **no side convention** — see
`src/client/constellation-boundaries/iau-geometry/README.md`.

## Labels and the region grid

`labels` is one anchor per IAU region — 89, so Serpens carries two — each
the equal-surface-weight centre of mass of its region, in ICRS, with the
region's area in square degrees at `AREA_DECIMALS = 2`. The areas
reproduce the published IAU values, which is why they ship rather than
being recomputed: they are the artifact's own self-check. Derivation and
the inside-the-region assertion are in
`src/client/constellation-boundaries/iau-geometry/README.md` § Label
anchors.

`regions` is the resolved cell grid, run-length-coded along RA
band-major: `runs` is `[cellCount, codeIndex, …]`, and 47,200 cells
collapse to ~2,960 runs (`boundaryRegionRuns` in build-counts) because
regions are contiguous blocks of columns. Runs never straddle a band, so
each band's counts sum to the column count — `validateRegionGridWire`
checks exactly that, **without allocating the grid**, so the load-time
validator can run it and `decodeRegionGrid` then fills with no failure
path of its own. A run list that stops short would otherwise decode to
unfilled cells, which resolve as a constellation named "undefined".

**`raDeg` / `decDeg` are the only unrounded numbers in the file.** The
runtime bisects them to resolve membership, so a rounded bound is a moved
wall: positions near it would get a different constellation from the byte
34 this same grid assigned. That costs ~2 KiB and buys one answer instead
of two that mostly agree.

## Subdivision is load-bearing

Each arc is resampled at `POLYLINE_MAX_STEP_DEG = 0.5` before precession.
That is not a smoothness nicety:

- A **constant-Dec** arc is a SMALL circle in B1875. Precession maps it to
  neither a straight line nor a great-circle arc, so a two-endpoint
  parallel draws a chord cutting **more than a degree** inside the true
  boundary. `src/client/constellation-boundaries/iau-geometry/iau-boundaries-pure.test.ts` pins that departure so a future
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
the runtime lerps a window out of the live magnitude limit.

The layer fades from the **1%** column to the **5%** column and rejects an
artifact that carries neither — dropping a quantile here is a wire change
that breaks a consumer, not a statistics tweak
(`src/client/constellation-boundaries/README.md` § Chart-mode layer). The
loader also pins what this emitter must hold to: `magLimits` ascending, one
`offsetsPc` row per magnitude row, and every row exactly `quantilePcts`
wide. Emitting a short row is the dangerous one — it resolves a quantile to
`undefined`, which reaches the fade factor as NaN.

Offsets are rounded to `FADE_OFFSET_DECIMALS = 4` — 1e-4 pc ≈ 20 AU
against a smallest emitted offset near 0.02 pc, so three significant
figures survive the tightest row, and the width stays fixed (see § Wire
shape on why that matters).

Rows are emitted only where ≥ `FADE_MIN_SAMPLES` (64) stars qualify — a
percentile over a handful of naked-eye stars is sampling noise — and the
build fails if fewer than two rows survive, since one row is a constant
no instrument limit can move. The runtime clamps outside the emitted range.
`sampleCounts` ships alongside so a thin row is visible rather than
implied.

The numbers are small on purpose: at V ≤ 6.5 the 5% quantile is under a
parsec. The nearest bright stars have enormous parallax — from α Cen,
Sirius shifts ~30° — so the boundaries are a Sol-neighbourhood affordance
that must self-hide before the first star. That is the correct outcome:
from another star, Earth's constellation boundaries do not describe the
sky.

## Cost

The sweep is one nearest-wall query per shipped record — ~390k against 781
arcs. The linear scan (`angularDistanceToNearestEdgeDeg`) would be a
quarter-billion arc evaluations and minutes of build time, so
`createIauConstellationLookup` routes through `createNearestEdgeIndex`,
which prunes on a declination-band lower bound. Exact, not approximate,
and pinned against the linear scan across a sphere-wide sampling grid.
The whole stage costs under a second.

`writeBoundaryArtifact` takes the lookup rather than building one, and
passes it whole to `buildBoundaryArtifact`: `loadReadStarsInputs` already
decomposed the edge set for byte 34 (`../parse/README.md` § Positional
constellation membership), so the arcs, the label anchors and the shipped
grid are three readings of that one decomposition — none of them can
disagree with the membership the catalogue shipped.
