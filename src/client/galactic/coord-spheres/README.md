# Coordinate spheres

The three toggleable "sky from here" reference grids — galactic l/b,
ecliptic λ/β and equatorial RA/Dec — sharing one geometry, one label engine,
and one spec table. This README replaces `../README.md` for reads inside this
folder; the parent keeps the galactic frame math, the disc outline, and the
HUD.

**Drawn in OBSERVE mode only.** In navigate the attitude indicator carries the
frame instead (`../../attitude/README.md`), and the two instruments are never
on screen together: one answer to "which way is north" at a time is what stops
them drifting apart. `Stellata.coordSphereDrawn(frame)` is that predicate, and
both the layer and the label pools read it rather than re-deriving it.

## Files in this area

```
src/client/galactic/coord-spheres/
  coord-sphere.ts                 The frame-agnostic CoordSphere grid
                                  geometry plus SPHERE_RADIUS_PC and the
                                  CoordSphereFrame tri-state.
  coord-sphere-frames.ts (+ test) The spec table: three CoordSphereSpecs
                                  (frame rotation, meridian spacing,
                                  label formatters, SVG label group),
                                  the shared north-pole reader, and the
                                  `S`-cycle step. Pinned against
                                  published star positions.
  coord-sphere-labels.ts (+ test) SVG edge labels for any sphere: one
                                  per grid line, dropped to the viewport
                                  edge that line exits.
```

One import reaches back into the parent and is genuinely shared rather than
split-avoidance: `galacticDirToIcrs` / `GALACTIC_NORTH_POLE_ICRS` from
`../galactic-coords.ts`, which the Milky Way volumetric layer uses too.
`SPHERE_RADIUS_PC` travels the other way — the
IAU boundary layer imports it from here
(`../../constellation-boundaries/README.md`), so every sky-sphere layer sits
on one radius.

## Coordinate spheres

Three toggleable spheres, **mutually exclusive** — `filter.coordSphere` is a
`'none' | 'galactic' | 'ecliptic' | 'equatorial'` four-state, not a set of
booleans. Two grids drawn together are illegible, and their edge labels would
fight in one `separateLabels` pass.

That same field is **the attitude indicator's frame** in navigate mode, which
is why it is not called `drawnSphere`: it is the app's one answer to "which
reference frame is selected", and which instrument shows it follows from the
camera mode.

`CoordSphere` (`coord-sphere.ts`) is the geometry, built once from a
`CoordSphereSpec`: equator + 16 latitude rings every 10° (−80° to +80°) +
`meridianCount` meridians, radius 50 kpc. `SPHERE_RADIUS_PC` is exported and
reused by the edge labels and the IAU boundary layer
(`../constellation-boundaries/README.md`), so everything sits on one sphere.

The spec (`coord-sphere-frames.ts`) pairs a frame's rotation with its meridian
spacing, label formatters and SVG label group in one record, so the geometry
and its labels cannot disagree about any of them:

| | galactic | ecliptic | equatorial |
| --- | --- | --- | --- |
| `dirToIcrs` | `galacticDirToIcrs` (GAL_TO_ICRS) | `eclipticDirToIcrs` — the equatorial mapping turned about x by `OBLIQUITY_RAD`, the two frames sharing the equinox as zero longitude | `equatorialDirToIcrs` (identity — catalog.bin's basis already has x at α 0h, z at the NCP) |
| meridians | 36, every 10° of *l* | 36, every 10° of *λ* | **24, every 15°** — an equatorial grid's meridians ARE the hour circles, which is also what makes every label a whole hour |
| labels | `l` / `b` in whole degrees | `λ` / `β` in whole degrees | RA in whole hours (`0h`…`23h`), dec signed (`+80°`) so a dec label never reads as a longitude |

The ecliptic grid takes the galactic parametrisation rather than the
equatorial one it is derived from: ecliptic longitude is measured in degrees,
and only an equatorial grid's meridians are hour circles.

**The ecliptic frame is pinned against three external anchors**, not against
the equatorial frame it rotates out of — that would only restate the rotation.
Pole at α 18h / δ +66.56° and λ=0 at the equinox fix the two axes; λ=90° at
α 6h / δ +23.44° is what catches an obliquity of the wrong sign, which would
otherwise still land a pole 66.56° off the equator, just the wrong one.

`coordSphereNorthPole(frame)` is the same table read for the frame's **pole** —
`dirToIcrs` at latitude +90°, precomputed once per frame, `none` → galactic.
It is what `L` levels the camera to in observe mode, where no instrument is on
screen and the drawn grid is the reference.

**The attitude indicator's frames are built from this table too.**
`buildReferenceFrames` (`../../attitude/attitude-pure.ts`) reads each frame's
pole and zero-longitude direction straight out of the spec's own `dirToIcrs`,
so there is one definition of galactic north rather than a matching pair that
could drift. `AutoFrameKey` is `DrawnCoordSphereFrame`, so the instrument
cannot offer a frame that has no sphere behind it either.

**Nothing outside the table names a sphere.** `DRAWN_COORD_SPHERE_FRAMES` is
the peer set, in panel order — widest reference plane first; the scene layer,
the sphere construction, the dispose fan-out, the label pools and the
instrument's frame table all iterate it and index `COORD_SPHERE_SPECS`, so a
further frame is a table entry plus one `<g>` in `index.html` rather than an
edit in five files. `CoordSphere` itself is frame-agnostic — no sphere is a
subclass, each is the same class handed a different spec.

The frames are pinned against **published star positions**, not against each
other: `coord-sphere-frames.test.ts` takes four naked-eye stars' catalogue
α/δ *and* l/b and requires each sphere to place the star on its own published
node, and requires the ecliptic grid to read a latitude of its own for every
one of them. A frame that were subtly wrong would still look like a plausible
grid, so external coordinates are the only check that bites.

- The **equator** is the chrome line seam's **fat stroke**
  (`../../chrome-lines/README.md` § The fat stroke brings its own object)
  at 2.4 px screen-space width — basic `LineBasicMaterial.linewidth`
  silently clamps to 1 in WebGL on most platforms, so a fat line is the
  only reliable way to get a thicker stroke, and the object class differs
  per backend, which is why the seam hands one back rather than a
  material. 256 segments around the full loop, closed by repeating the
  first vertex (a fat line is an open polyline); the small joint-wedge
  "ticks" you may notice are an inherent artefact of fat-line miters at
  non-trivial angles. Bumping segment count to 1024 hides the ticks but
  was rejected as visually similar; we kept 256.
  **Nothing here writes the screen-space width's resolution divisor, and
  nothing should.** The width divides by it, so it has to track the
  canvas — but since r185 `LineSegments2` sets it from
  `renderer.getViewport()` before every draw, on both backends. That is
  the same number an app-side write could supply (the renderer is sized in
  CSS pixels and nothing calls `renderer.setViewport`), so a resize hook
  here would be a second writer of a value three already owns, going stale
  the moment either side changed. `tests/README.md` § The three upgrade
  audit carries it as a line to re-check on the next bump.
- **Latitude rings + meridians** take the seam's solid stroke at 0.45
  opacity, over `../../util/orbit-line.ts`'s `makeOrbitLineLoop` /
  `makeOrbitLine` — an index-closed `THREE.Line` rather than
  `THREE.LineLoop`, which the WebGPU renderer refuses outright. Polar
  bunching is eased by trimming every *odd-indexed*
  meridian to ±80° latitude (`meridianMaxAbsLatDeg`) — the even set still
  goes pole-to-pole unbroken, so 36 galactic lines ease to 18 and 24
  equatorial ones to 12.
- **No pole markers.** Earlier iterations had small + crosses at
  NGP/SGP; they read as visual clutter and were dropped.
- Every sphere tracks the camera each frame
  (`group.position.copy(camera.position)`), so each conceptually
  represents "the sky from here". Orientation is fixed in absolute space
  — the geometry is already in ICRS — so b=0 / l=0 and α 0h / δ 0° stay
  correctly aimed through any camera move including warp. The IAU boundary
  layer sits on the same sphere and deliberately does **not** track the
  camera: its partition is only true from Sol, so it stays pinned there and
  fades out instead.
- **Chart mode runs the strokes opaque** with blending off for the paper
  aesthetic; `setMonochrome` is the only thing that moves either alpha, so the
  blend-state reconfigure (a program recompile via `needsUpdate`) fires on a
  style flip and never per frame. **The flip goes through the seam handle's
  `setOpaque`, never `material.transparent`** — the fat stroke's WebGPU
  material answers that flag with a full-frame texture read of the target
  it is drawing into (`../../chrome-lines/README.md` § The layer writes
  `material`, never a wrapper).

### A frame is offered where it describes something

Declination is measured from Earth's rotational axis and right ascension from
the vernal equinox, so — unlike galactic coordinates, defined by the Milky
Way's actual disc plane and centre and therefore meaningful from anywhere in
the galaxy (AGENTS.md § Camera-anywhere, any-epoch) — the RA/Dec frame is a
property of one body. The ecliptic sits between: it is the plane Sol's planets
share, a reference across that system and an arbitrary tilt outside it.

That rule is keyed on **what is focused**, not on camera distance, and it lives
in `../../attitude/attitude-pure.ts` because the same answer governs the
instrument: `frameAvailableFor` reads it off `autoFrameFor` rather than
restating "in Sol's system", so the two cannot drift. Galactic everywhere, the
ecliptic wherever the focus rule already lands inside Sol's system, RA/Dec on
Earth alone. `Stellata.coordSphereAvailable` binds it to the live focus, and
the `S` cycle, the panel's stops and the demotion below all gate on that one
predicate.

**`coordSphere` never names a frame the focus gives no meaning to.**
`frameAfterFocusChange` runs on every focus change: it keeps the selected
frame where the new object still allows it and demotes to that object's own
default where it does not. Earth → Luna swaps RA/Dec for the ecliptic, Luna →
Jupiter keeps the ecliptic, Jupiter → Algol falls to galactic; a frame already
on galactic survives anywhere, and `none` survives anywhere. It is idempotent
by construction — what it answers is available at the focus it answered for —
and pinned that way, since otherwise a second focus change onto the same
object would move the frame again.

The demotion is what a Sol-distance fade window used to approximate. Keying on
the focus rather than on parsecs is both narrower and honest: in observe mode
the camera sits *on* the focused object, so a distance threshold could only
ever restate where that object is.

**Grid orientation labels** (`coord-sphere-labels.ts`) — SVG `<text>` under
`#gal-grid-labels` / `#ecl-grid-labels` / `#eq-grid-labels`, one pool per
sphere, pooled once (one per line) and positioned + rotated each frame.
`main.ts` passes each pool a `groupOpacity` closure — **an alpha, not a
boolean**, and the one caller left drives it from `coordSphereDrawn` at 1 or 0.
The alpha is kept because it is the seam a partially-shown grid would need, and
because at full strength the attribute is *removed* rather than set to `1`, so
a grid keeps exactly the CSS alpha it always had. Every group hides in warp via
`body.warping #overlay`.
**One label per grid line** — every meridian and every latitude ring (incl.
the equator; no ring at the ±90° poles). Each line's sample directions are
precomputed once through the spec's own `dirToIcrs`, the same frame the grid
geometry uses — fixed in absolute space; per frame they project through
`camera.position + dir × SPHERE_RADIUS_PC` so labels track the camera exactly
like the grid.

Rather than sit on the l/b node (where the text would cross the orthogonal
line), each label **drops along its own line to where the line exits the
viewport** — the bottom-most edge crossing wins ("drops downhill"), with the
whole rotated text box kept `ORTHO_PAD_PX` (10 px) inside the crossed edge and
rotated onto the crossing segment's tangent (folded into (−90°, 90°] to stay
upright). Crossings whose box would land within 10 px of on-screen chrome
(settings panel, brand box, scale bar, meta — queried by id each frame,
hidden elements ignored) are skipped so a label never overlaps them; the
next-best crossing is used, or the label hides if none survives. Where many
lines converge near an edge, a **deterministic repulsion pass**
(`separateLabels`) spreads overlapping labels apart (fixed-order pairwise
push + shove-out-of-chrome + re-clamp — no randomness, so a static camera is
stable). Edge placement and repulsion are the pure, tested `edgeLabelPlacement`
/ `separateLabels`. Values are whole degrees / whole hours because every grid
line lands on one — the per-frame formatters are in the spec table above.
