# IAU constellation boundaries

The shipped Delporte (1930) partition: the artifact that carries it, the
positional lookup that answers "which constellation is this position in"
for **any** position — catalogued star, anonymous Gaia row, galaxy,
cloud, or planet — and the chart-mode layer that draws it.

Assignment is purely positional and epoch-independent: precess the
position to B1875.0, test it against arcs that are constant-RA /
constant-Dec lines in that equinox. Nothing about a catalogue entry
enters into it.

The geometry those arcs and regions are *derived* from — edge parsing,
the cell decomposition, nearest-edge distance, the label-anchor
derivation, and the external checks on all of it — is
`iau-geometry/README.md`.

## Files in this area

```
src/client/constellation-boundaries/
  iau-geometry/                   The pure B1875 geometry, its own README.
  constellation-boundary-layer.ts The chart-mode layer (§ Chart-mode layer).
    (+ test)
  boundary-artifact-loader.ts     Fetch + validate the shipped artifact.
    (+ test)
  boundary-layer-pure.ts          Polyline → line-segment vertex expansion
    (+ test)                      + dash phase, and the fade window. Pure.
  constellation-regions.ts        Both readings of the shipped region set:
    (+ test)                      the runtime membership namer
                                  (§ Runtime membership) and the chart label
                                  anchors baked to the boundary sphere
                                  (§ Label anchors).
```

## How each consumer gets this

**The edge set is Node-side only** (`iau-geometry/README.md`), so every
runtime consumer reads the built artifact, never the edges:

- **Star assignment** runs at **build time**, through
  `createConstellationAssignment`
  (`../../../scripts/catalog/parse/constellations.ts`), which binds the
  geometry's lookup to the IAU-88 index space. Every record's own
  position resolves into catalog byte 34; the browser reads the answer.
  See `scripts/catalog/parse/README.md` § Positional constellation
  membership.
- **Drawing, labelling and runtime membership** all ride
  `public/constellation-boundaries.json` — arcs, label anchors
  (§ Label anchors), and the resolved cell grid (§ Runtime membership).
  `buildBoundaryArtifact` takes the whole lookup, not just its edges, so
  all three come from **one** decomposition: the same one byte 34 was
  assigned from. `scripts/catalog/boundaries/README.md` owns the wire.

## Runtime membership

`createConstellationRegions` (`constellation-regions.ts`) answers "which
constellation is this position in" in the browser: it decodes the
artifact's run-length cell grid, binds B1875 through
`createGridConstellationLookup`, and maps the region key onto the IAU-88
table the catalog artifact already carries. Absolute (Sol-centred ICRS)
position in, name out; **null at the origin**, the one hole byte 34
leaves too. It returns the label anchors off that same decode and the
same keyed table (§ Label anchors) — one entry point, because every
caller wants both.

**The grid ships rather than being re-derived, and its bounds are the
only unrounded numbers in the artifact.** `constellationEdgeCodeAt`
bisects them, so a rounded bound is a moved wall and the runtime would
answer a different constellation from byte 34 near one — pinned across a
sphere-wide sampling grid in `constellation-regions.test.ts`, and
rejected at load unless both bound arrays ascend.

Which kinds route through `Stellata.constellationOf`, why stars don't,
and why every answer is Sol-frame: `../focus-card/README.md`
§ Constellation row.

## Label anchors

One per region, so **Serpens carries two** — the derivation, the
published-area agreement, and the assertion that every anchor lands
inside the region it names are `iau-geometry/README.md` § Label anchors.
Anchors arrive in ICRS off the artifact and are baked to
`SPHERE_RADIUS_PC` at attach, exactly as the arcs are, so a label rides
the block it names from any camera position. The chart writes the Latin
name there (`../chart-mode/labels/README.md` § Label engine); the closure check
on the shipped areas is `boundary-artifact-loader.ts`, which is why the
areas ride the wire at all.

**The trade, stated plainly.** A label is Sol-frame chrome now: it
tracks the *partition*, not the *stars*. Inside the Sol neighbourhood
the two readings are indistinguishable — member stars at tens to
hundreds of parsecs against an anchor 50 kpc out — but past a few
hundred parsecs the label holds Earth's sky position while its stars
have swung away. That is the right way round, since Earth's
constellations describe nothing from elsewhere. Note the labels
deliberately do **not** share the arcs' sub-parsec distance fade
(§ Chart-mode layer): between the fade-out and a few hundred parsecs
the names are drawn over a partition that isn't, and tying them to that
window would delete every constellation name before α Cen.

## Chart-mode layer

`ConstellationBoundaryLayer` draws the artifact's arcs as one
`THREE.LineSegments` — every arc in a single draw call, ~18.6k vertices,
built once on attach. `boundaryLineAttributes` expands each polyline into
its own endpoint pairs, so consecutive edge records never join across the
seam between them.

**Dotted, and the dash phase is ours.** Sky Atlas 2000.0 draws the partition
as a fine dotted line at the same stroke weight as its solid coordinate grid,
which is the convention this follows: `BOUNDARY_DOT_PX` / `BOUNDARY_GAP_PX`
(1.5 px / 3 px) on a `LineDashedMaterial`.

**Sized in screen pixels, not degrees of sky.** The paper pattern is ~0.1° per
dot; at any FOV reachable here that is sub-pixel, and a sub-pixel stipple reads
as a faint *solid* line — the failure mode to expect from an angular pattern.
So the dots hold their pixel size and the sky spacing rides the zoom. The
conversion is `material.scale` (three shades on `scale × lineDistance`), set
per frame in `update` from the shared `uFovYRad` / `uViewport` slots:
`pixelsPerRadian / SPHERE_RADIUS_PC`. One scale covers the whole sphere — the
arcs sit 50 kpc out and the camera never leaves Sol's neighbourhood while they
draw, so every vertex is at effectively the same range. `scale` left at its
default 1 would make each dot 1.5 **parsecs** long on a 50 kpc sphere: nothing
drawn at all.

`boundaryLineAttributes` emits the `lineDistance` attribute itself, accumulated
along each polyline. `THREE.Line.computeLineDistances()` cannot be used here:
on a `LineSegments` it restarts the phase at every *pair*, so each subdivision
node begins a fresh dot and any node closer together than `dashSize` draws that
stretch solid — a subdivided arc set comes out looking like a solid line, with
nothing in the material to point at. Each arc still restarts at 0, matching the
segment split above.

**Sol-centred, not camera-tracked.** This is the deliberate difference
from the galactic coordinate sphere, which does track the camera: the
partition is a Sol-frame construct, and pinning it to Sol is what keeps a
star assigned to Orion drawn inside Orion's cell. The arcs bake once into
absolute ICRS at `SPHERE_RADIUS_PC` (50 kpc, imported from
`../galactic/coord-spheres/coord-sphere.ts` — the same sphere the coordinate grids use)
and the group rebases to `−worldOffset` each frame, exactly like
`../galactic/galactic-disc.ts`.

**Distance-from-Sol fade — `solFrameFadeFactor`, the inverse of the far-field
reveal in `../galactic/galactic-fade.ts` and shared with the equatorial
coordinate sphere.** A drawn boundary is a pure Sol-frame projection with no
3D referent, so it must *self-hide* as the camera leaves the neighbourhood
rather than reveal as the camera pulls back. Only the **curve** is shared;
this layer's **window** is its own, and is not taste-picked: it interpolates
the artifact's quantile table against the live magnitude limit
(`resolveBoundaryFadeWindowPc`), fading from the offset where **1%** of the
visible population reads as misplaced to where **5%** does. Both
percentiles must be columns of the artifact's own `quantilePcts` — the
loader rejects an artifact that dropped either rather than silently using
a neighbouring column. `setMagnitudeLimit` is *pushed* from the shell's
filter handler (folded into the same `filter` subscription that rebuilds
the figure), so the interpolation runs once per slider change rather than
per frame.

`solFrameFadeFactor` tests its window as `!(outerPc > innerPc)`, not
`outerPc <= innerPc`. The negated form is what routes a **NaN** window into
the step branch and hides the layer: a NaN opacity never reads as ≤ 0, so
passing one through draws the partition at full strength from every
distance — the fade silently not firing at all, which is the one failure
this layer cannot tolerate.

The resulting window is sub-parsec to a few parsecs, so the arcs vanish
well before the camera reaches α Cen — pinned in the layer test. That is
the correct outcome, not a limitation: from another star, Earth's
constellation boundaries do not describe the sky. The derivation and the
quantile numbers live in `scripts/catalog/boundaries/README.md` § Fade
table.

**Validated at load, but never fatal.** `validateBoundaryArtifact` rejects
anything but `frame: "ICRS"`, because B1875 directions rendered as if they
were ICRS produce a plausible-looking sky sitting ~1.4° off every star —
the failure mode `iau-geometry/README.md` § B1875 describes, and one
no spot check catches. It also
pins the fade table's shape: ascending `magLimits` (the bracketing walks
forwards), one offset row per magnitude row, and every row exactly as wide
as `quantilePcts` — a short row resolves a quantile to `undefined`, which
reaches the fade factor as NaN.

`loadBoundaries` wraps all of that and **cannot reject**: `main.ts` loads it
inside a `Promise.all` alongside the catalog, so a rejection blanks the
whole app rather than dropping one optional layer. A missing asset can't be
detected by status alone either — `not_found_handling =
"single-page-application"` (`wrangler.toml`) answers it with index.html at
200, so an undeployed artifact arrives as a JSON parse error, not a 404.
Absent resolves null silently; present-but-invalid warns and resolves null,
the contract `../local-group/local-group-loader.ts` uses for a stale
artifact. Dropping the layer still honours the frame check — a B1875-framed
artifact never reaches the GPU.

**Gates.** A chart-only declutter element, `constellationBoundaries` at
floor `{ realistic: 'never', chart: 'all' }` (`../scene/README.md`). That
floor is the whole visibility answer — the `showConstellation` master toggle
that used to AND with it is retired. The shell's registry entry ANDs the
floor with the shared warp gate.

**Ink.** `CHART_REFERENCE_INK` (`../chart-mode/chart-palette.ts`), shared
with the coordinate sphere, at half its weight — and dotted where the grid
is solid (§ Chart-mode layer), so the two reference layers stay
distinguishable when drawn together. `renderOrder −0.8` puts the partition
under the constellation figure (−0.75) and over the galactic disc / grid
(−1); `depthTest` is off because the chart starfield renders
depth-disabled, the same treatment the figure takes in chart mode. The
material is bound through `setBuiltinChromeColour`'s **chart** variant —
chart mode bypasses the HDR resolve, so the tone-map inverse must not be
applied (`../hdr/README.md`).
