# IAU constellation boundaries

The Delporte (1930) boundary arcs: the B1875 edge set, its decomposition
into named sky regions, the positional lookup that answers "which
constellation is this position in" for **any** position — catalogued
star, anonymous Gaia row, galaxy, cloud, or planet — and the chart-mode
layer that draws the partition.

Assignment is purely positional and epoch-independent: precess the
position to B1875.0, test it against arcs that are constant-RA /
constant-Dec lines in that equinox. Nothing about a catalogue entry
enters into it.

## Files in this area

```
src/client/constellation-boundaries/
  iau-boundaries-pure.ts          Edge parsing, the cell decomposition,
    (+ test)                      point lookup, nearest-edge distance (linear
                                  scan + the banded index), the ICRS polyline
                                  resampling, the per-region label anchors
                                  (§ Label anchors), and
                                  createIauConstellationLookup. Pure.
  iau-athyg-agreement.test.ts     Catalogue-wide cross-check against AT-HYG's
                                  editorial con column (§ Agreement).
  constellation-boundary-layer.ts The chart-mode layer (§ Chart-mode layer).
    (+ test)
  boundary-artifact-loader.ts     Fetch + validate the shipped artifact.
    (+ test)
  boundary-layer-pure.ts          Polyline → line-segment vertex expansion
    (+ test)                      + dash phase, and the fade window. Pure.
  constellation-regions.ts        The two readings of the shipped region set:
    (+ test)                      the runtime membership namer
                                  (§ Runtime membership) and the chart label
                                  anchors baked to the boundary sphere.
```

**Use `createIauConstellationLookup(records)`, not the pieces.** It parses,
decomposes, and binds the B1875 rotation, so its `edgeCodeAt` / `keyAt` /
`distanceToNearestEdgeDeg` all take **J2000** positions. The lower-level
`constellationEdgeCodeAt(grid, …)` and
`angularDistanceToNearestEdgeDeg(edges, …)` expect input already at B1875
— handing them a J2000 position resolves to a real constellation, just
the wrong one (`(20, −60)` reads Hydrus instead of Tucana), which is why
the composition lives in one place rather than at each call site.

The edge records are read from the committed Stellarium file by
`readIauEdgeRecords` (`scripts/catalog/parse/constellations.ts`); B1875
precession is `../util/precession.ts`.

## How each consumer gets this

**The edge set is Node-side only.** `readIauEdgeRecords` is a
`readFileSync` against `data/`, which is not served, so nothing in the
browser can call it — every runtime consumer reads the built artifact,
never the edges:

- **Star assignment** runs at **build time**, through
  `createConstellationAssignment`
  (`scripts/catalog/parse/constellations.ts`), which binds this module's
  lookup to the IAU-88 index space. Every record's own position resolves
  into catalog byte 34; the browser reads the answer, never the edge set.
  See `scripts/catalog/parse/README.md` § Positional constellation
  membership.
- **Drawing, labelling and runtime membership** all ship in
  `public/constellation-boundaries.json`: `buildBoundaryPolylines`
  supplies the subdivided precessed-to-ICRS arcs,
  `buildRegionLabelAnchors` the per-region label anchors, and the
  **resolved cell grid** rides along for positions the catalogue never
  classified (§ Runtime membership).
  `scripts/catalog/boundaries/README.md` owns the wire shape.

`buildBoundaryArtifact` takes the whole lookup, not just its edges, so
the arcs, the labels and the shipped grid come from **one**
decomposition — the same one byte 34 was assigned from. Three readings
of one partition; nothing to disagree.

Importing `iau-boundaries-pure` from a browser module is fine for the
pure geometry (that is how `constellation-regions.ts` gets its lookup),
but reaching for `readIauEdgeRecords` from one is how the edge set ends
up parsed in the browser from a file that isn't deployed.

## Runtime membership

`createConstellationNamer` (`constellation-regions.ts`) answers "which
constellation is this position in" in the browser: it decodes the
artifact's run-length cell grid, binds the B1875 precession through
`createGridConstellationLookup`, and maps the region key onto the
IAU-88 table the catalog artifact already carries. Absolute
(Sol-centred ICRS) position in, constellation name out; **null at the
origin**, the one hole byte 34 leaves too.

**The grid is shipped rather than re-derived, and its bounds are the
only unrounded numbers in the artifact.** `constellationEdgeCodeAt`
bisects those bounds, so a rounded bound is a moved wall and the
runtime would answer a different constellation from byte 34 for a
position near one. Full precision costs ~2 KiB and buys one answer
instead of two that mostly agree — pinned across a sphere-wide sampling
grid in `constellation-regions.test.ts`.

Consumers are the objects the build never classified, all through
`Stellata.constellationOf(kind, idx)`: Local Group galaxies, molecular
clouds, boundary-crossing probes, and the planets, whose answer is a
**time-varying ephemeris statement** rather than a property of the body
— it tracks `getT()` because the position does. Sol-frame for every
kind, matching the star card (`../focus-card/README.md`
§ Frame-of-reference principle). **Stars do not route here**: byte 34 is
the shipped authority, survives a missing artifact, and carries the
designation-constellation split beside it.

## Label anchors

`buildRegionLabelAnchors` gives each region the **equal-surface-weight
centre of mass** of its own cells — where the chart writes the Latin
name (`../chart-mode/README.md` § Label engine). Each cell is a
spherical rectangle in B1875, so its area and its integral of the unit
direction both close in elementary functions: no sampling, and the
vector sum over a region is exactly its centre of mass.

Two properties make this externally checkable rather than merely
plausible:

- **The areas reproduce the published IAU constellation areas** to three
  decimals (Hydra 1302.844, Virgo 1294.428, Crux 68.447, Serpens
  636.928 across its two parts) and sum to the full sphere. Nothing in
  the pipeline supplies those numbers — the edge set alone determines
  them, so agreement corroborates the decomposition the same way the
  89-region count does.
- **Every anchor is asserted to land inside the region it names**, and
  the walk throws rather than emit one that doesn't. A centre of mass
  is only guaranteed inside a convex region, and this is the exact
  failure the flux-weighted centroid it replaced had: Serpens' label
  sat in the Caput/Cauda gap, which is Ophiuchus. Keeping SER1/SER2
  split is what keeps the assertion true — a merged Serpens anchor
  would fail it, not slip past it.

The anchors are emitted in ICRS and baked to `SPHERE_RADIUS_PC` at
attach, exactly as the arcs are, so a label rides the block it names
from any camera position instead of drifting off it.

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
the failure mode § B1875 describes, and one no spot check catches. It also
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
floor `{ realistic: 'never', chart: 'all' }` (`../scene/README.md`), which
also puts it behind the `showConstellation` master toggle (`C`) with the
figures and the Latin names — one switch for every piece of constellation
chrome. The shell's registry entry ANDs that with the shared warp gate.

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

## The edge set

`data/stellarium/stellarium-modern-skyculture.json` carries an `edges`
array of **781** records — 389 meridians (constant RA) and 392
parallels (constant Dec) — at equinox **B1875**, sourced from
pbarbier's `edges_18.txt`. Each names the two constellations it
separates:

```
097:096 M+ 20:08:30 +08:30:00 20:08:30 +15:45:00 DEL AQL
```

**The CON1/CON2 order carries no side convention.** Do not read it as
"A lies west of B" — the labelling below never depends on it.

A parallel arc always runs **eastward** from its first RA to its
second, so a second RA at or below the first wraps through RA 0. Taking
`min`/`max` instead keeps the complementary arc and quietly walls off
most of the sky (11 of the 392 wrap). Both endpoints are stored exactly
as parsed, never as `start + span`: the cell grid keys on exact
equality against them and a reconstructed end differs in the last float
digit, which splinters 236 RA bounds into 259.

## B1875

`B1875_JD` (`../util/precession.ts`) is 2405889.2586 — **1874 Dec
31.76**, by the Besselian epoch formula, not a Julian-year offset from
J2000. The rotation is the IAU 1976 (Lieske) composition
Rz(−z)·Ry(−θ)·Rz(−ζ).

Two ways to get this wrong, both of which still produce a
plausible-looking sky:

- **θ negated.** Every position lands 2θ ≈ 1.4° off in declination.
  Agreement with AT-HYG collapses to 92.8%.
- **The epoch off by months.** Six months late (1875 Jun 2 instead of
  1874 Dec 31) shifts RA by ~17″ and triples the disagreement count
  from 61 to 149 while every named-star spot check still passes.

The epoch is therefore pinned by the disagreement count, not by spot
checks. See § Agreement and § ρ Aquilae.

## Cell decomposition — the self-validating invariant

`buildConstellationRegions` turns the edge set into named regions:

1. The distinct RA and Dec values across all edges induce a
   **236 × 200** cell grid (236 cyclic RA columns, 199 Dec bounds → 200
   bands closed by ±90).
2. Union adjacent cells no edge separates. A meridian at the shared RA
   walls two columns apart only where it spans the whole Dec band; a
   parallel at the shared Dec walls two bands apart only where it spans
   the whole RA column.
3. Name each region by **intersecting the {CON1, CON2} pairs of every
   edge bounding it**. A set intersection, so it is convention-free.

RA adjacency is cyclic, and that is also what closes the polar caps: no
meridian reaches past ±85°, so every cell in the outermost band
connects around to its neighbours (Octans south, Ursa Minor north). No
special case needed.

The walk yields **exactly 89 regions, each with a distinct name** —
`IAU_REGION_COUNT`. Nothing in the pipeline supplies that number: the
edge pairs alone determine it, and 89 is 88 constellations plus
Serpens' two disjoint parts. So the count matching is a genuine
self-check, and `buildConstellationRegions` **throws** rather than ship
a half-resolved sky. A drift means the source data changed or the cell
walk broke — no lookup table (Roman 1987 / VI/42) is needed or
consulted.

## Serpens

The edge set names `SER1` (Caput) and `SER2` (Cauda) because they are
genuinely disconnected regions. `constellationEdgeCodeAt` returns
whichever one the position is in; `constellationKey` collapses both to
`ser`, the lowercase key `CON_INDEX`
(`scripts/catalog/parse/constellations.ts`) indexes the IAU-88 table
by.

**Membership collapses them; placement must not.** A star in either
half is in Serpens, full stop — that is the IAU answer and what byte 34
carries. But anything *placed* per region keeps the split: the chart
draws two "SERPENS" labels, one per part, because any single point
representing the union lands in the gap between them, which is
Ophiuchus (§ Label anchors).

## ρ Aquilae

ρ Aql / 67 Aql (HIP 99742) is the one designated star whose positional
constellation is **not** its nomenclature constellation: IAU naming
keeps it in Aquila, its position is in **Delphinus**. It crossed the
20h08m30s wall by proper motion — published as 1992.

The margin is 0.381″ past the wall at the catalogue's J2000 position.
That is thin by design and it is a *feature* of the pin: walking the
margin back through the star's own proper motion (55.4 mas/yr in
α·cos δ) dates the crossing to 1993.4, which is independent external
corroboration that the B1875 epoch and the rotation are both right. A
wrong epoch moves the implied date by centuries.

This is why positional membership and the designation's constellation are
carried as separate fields (byte 34 and search-index `dc`) — making the
catalogue's constellation positional would otherwise have rewritten this
star's search aliases from "Rho Aql" to "Rho Del". See
`scripts/catalog/README.md` § Search index for the split.

## Agreement with AT-HYG

`iau-athyg-agreement.test.ts` walks all **317,174** AT-HYG rows that
carry a `con` cell (Sol is the one row that does not) and compares the
computed assignment against that editorial column:

| | |
| --- | --- |
| Agreement | 99.98% |
| Disagreements | **61**, pinned exactly |
| Of those, carrying a Bayer / Flamsteed designation | 1 — ρ Aql |

Almost all of the other 60 are anonymous rows sitting within an arcsecond
or so of a wall, where an editorial cell has no nomenclature to answer
to. Two carry **GCVS** designations, and they are different cases:

- **CM Ind** is a genuine mover — named for Indus, positionally in
  **Pavo**, the same shape as ρ Aql.
- **LT Vul** is not. It is named for Vulpecula and it *sits* in
  Vulpecula; AT-HYG's cell says **Sagitta** and is simply wrong. The
  designation and the boundaries agree with each other against the
  catalogue column, which is why the designation — not the column — is
  the authority for `desigConIndex`
  (`scripts/catalog/parse/README.md` § Positional constellation
  membership).

The CSV has no GCVS column — that cross-match happens later in the build
— so this suite sees neither; `designationConMismatch` in build-counts is
where the designated movers are pinned.

The count is pinned as an exact number rather than a rate because it is
the sharpest signal available on the precession epoch (§ B1875).

**This suite measures AT-HYG's printed ra/dec; the build measures the
resolved position.** They are not the same number: the build's
`conPositionalDisagreement` is **63**, because the direction cascade
(Gaia 5p → HIP2 → printed) moves six anonymous sub-arcsecond-from-a-wall
rows, four across into disagreement and two back out. Both are correct
for what they measure — this one isolates the epoch and the
decomposition, which is why it stays on the printed column.

The CSV rides LFS, so the suite self-skips in the bare CI `test` job and
runs smudged in **`tier-a-corpus`**, which names the file explicitly.
A `describe.skipIf` suite that no job names runs nowhere: check
`.github/workflows/test.yml` when adding another.

AT-HYG shares no input with the edge set, so this is external
validation of both the epoch and the decomposition. It is also why the
positional assignment can replace the editorial column outright:
AT-HYG's `con` covers only its own rows, while this covers every
position, including the uncatalogued fill tier.

## Nearest-edge distance

`angularDistanceToNearestEdgeDeg` gives the angular distance from a
B1875 position to the closest boundary arc, measured across the sphere:

- **Meridian** — a constant-RA great circle. The perpendicular foot does
  **not** keep the point's own declination: it sits at
  `atan2(sin δ, cos δ·cos Δα)`, which leaves ±90° once the point is more
  than a quarter turn away in RA. Past that the foot is on the
  *antimeridian* half of the circle, off the arc, so the branch is gated
  on the **foot's** declination, never the point's. With the foot inside
  the span the distance is the point's angle out of the circle's plane
  (a 1° RA offset at dec 80 is 0.17° of sky); otherwise the nearer of the
  two endpoints wins. Gating on the point's declination instead reports
  0° for a wall 20° away and under-reports by up to 4.6° over the real
  edge set — pinned by exact per-star values, since a range check passes
  either way.
- **Parallel** — a constant-Dec small circle, so the shortest path runs
  along the point's own meridian and an in-span point is |Δdec| away;
  out of span, the nearer endpoint again. No antimeridian trap here: the
  arc parameter *is* RA, so the in-span test and the nearest point agree.

This feeds the fade window for drawing the boundaries. A boundary is a
Sol-frame projection, so the offset at which a star reads as being in
the *wrong* cell is `(distance to its wall + tolerance) × its distance
from Sol` — sub-parsec for the naked-eye population, which is what
makes the drawn boundaries a Sol-neighbourhood affordance that
self-hides before the first star.

**Cost.** `angularDistanceToNearestEdgeDeg` is a linear scan of all 781
arcs with 2–4 trig calls each — a quarter-billion evaluations over the
full catalogue, which the fade table needs. `createNearestEdgeIndex`
buckets the arcs by declination band and prunes: any point on an arc lies
inside the arc's own declination range, and angular separation is at least
the declination difference, so a band's declination gap from the query is
a valid **lower bound** on every arc bucketed there. Once that gap exceeds
the best distance found so far, no remaining band can improve on it.

That makes the index **exact, not approximate** — the same answer as the
scan, pinned against it across a sphere-wide sampling grid, and the whole
catalogue sweep costs under a second.
`createIauConstellationLookup.distanceToNearestEdgeDeg` routes through it,
so there is no slow path left to pick by mistake; the linear scan stays as
the reference implementation.

## ICRS polylines

`buildBoundaryPolylines` resamples each arc along its own B1875 geometry
and carries every sample to ICRS. **Subdividing is not an optimisation:** a
constant-Dec arc is a SMALL circle, and precession maps it to neither a
straight line nor a great circle, so a two-endpoint parallel draws a chord
cutting over a degree inside the true boundary. Meridians are great
circles and would survive two endpoints; they subdivide anyway for one
code path. The wire format, the quantisation, and the fade table are
`scripts/catalog/boundaries/README.md`.
