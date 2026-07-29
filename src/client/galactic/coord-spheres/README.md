# Coordinate spheres

The two toggleable "sky from here" reference grids — galactic l/b and
equatorial RA/Dec — sharing one geometry, one label engine, and one spec
table. This README replaces `../README.md` for reads inside this folder;
the parent keeps the galactic frame math, the disc outline, the HUD, and
the distance-fade curves these grids consume.

## Files in this area

```
src/client/galactic/coord-spheres/
  coord-sphere.ts                 The frame-agnostic CoordSphere grid
                                  geometry plus SPHERE_RADIUS_PC and the
                                  CoordSphereFrame tri-state.
  coord-sphere-frames.ts (+ test) The spec table: both CoordSphereSpecs
                                  (frame rotation, meridian spacing,
                                  label formatters, SVG label group,
                                  optional fade window), the fade /
                                  reachability readers, and the `S`-cycle
                                  step. Pinned against published star
                                  positions.
  coord-sphere-labels.ts (+ test) SVG edge labels for either sphere:
                                  one per grid line, dropped to the
                                  viewport edge that line exits.
```

Two imports reach back into the parent, both genuinely shared rather than
split-avoidance: `galacticDirToIcrs` / `GALACTIC_NORTH_POLE_ICRS` from
`../galactic-coords.ts` (the Milky Way volumetric layer uses them too) and
`solFrameFadeFactor` from `../galactic-fade.ts` (the disc rides the same
module’s far-field reveal). `SPHERE_RADIUS_PC` travels the other way — the
IAU boundary layer imports it from here
(`../../constellation-boundaries/README.md`), so every sky-sphere layer sits
on one radius.

## Coordinate spheres

Two toggleable spheres, **mutually exclusive** — `filter.coordSphere` is a
`'none' | 'galactic' | 'equatorial'` tri-state, not a pair of booleans. Two
grids drawn together are illegible, and their edge labels would fight in one
`separateLabels` pass.

`CoordSphere` (`coord-sphere.ts`) is the geometry, built once from a
`CoordSphereSpec`: equator + 16 latitude rings every 10° (−80° to +80°) +
`meridianCount` meridians, radius 50 kpc. `SPHERE_RADIUS_PC` is exported and
reused by the edge labels and the IAU boundary layer
(`../constellation-boundaries/README.md`), so everything sits on one sphere.

The spec (`coord-sphere-frames.ts`) pairs a frame's rotation with its meridian
spacing, label formatters, SVG label group, and optional Sol-distance fade in
one record, so the geometry and its labels cannot disagree about any of them:

| | galactic | equatorial |
| --- | --- | --- |
| `dirToIcrs` | `galacticDirToIcrs` (GAL_TO_ICRS) | `equatorialDirToIcrs` (identity — catalog.bin's basis already has x at α 0h, z at the NCP) |
| meridians | 36, every 10° of *l* | **24, every 15°** — an equatorial grid's meridians ARE the hour circles, which is also what makes every label a whole hour |
| labels | `l` / `b` in whole degrees | RA in whole hours (`0h`…`23h`), dec signed (`+80°`) so a dec label never reads as a longitude |
| `fadeWindow` | **absent** — meaningful from anywhere | 0.4 → 2.0 pc (§ below) |

**Nothing outside the table names a sphere.** `DRAWN_COORD_SPHERE_FRAMES` is
the peer set; the scene layer, the resize hook, and the label pools all iterate
it and index `COORD_SPHERE_SPECS`, so a third frame is a table entry rather
than an edit in five files. `CoordSphere` itself is frame-agnostic — the
equatorial sphere is *not* a subclass, it is the same class handed the other
spec plus the fade its spec declares.

The two frames are pinned against **published star positions**, not against
each other: `coord-sphere-frames.test.ts` takes four naked-eye stars' catalogue
α/δ *and* l/b and requires each sphere to place the star on its own published
node. A frame that were subtly wrong would still look like a plausible grid, so
external coordinates are the only check that bites.

- The **equator** is a `Line2` with `LineMaterial` (from
  `three/examples/jsm/lines/`) at 2.4 px screen-space width — basic
  `LineBasicMaterial.linewidth` silently clamps to 1 in WebGL on most
  platforms, so Line2 is the only reliable way to get a thicker stroke.
  256 segments around the full loop; the small joint-wedge "ticks" you
  may notice are an inherent artefact of fat-line miters at non-trivial
  angles. `LineMaterial` requires its `resolution` uniform to track the
  canvas, so `Stellata.onResize` calls `setResolution(w, h)` on both spheres.
  Bumping segment count to 1024 hides the ticks but was rejected as
  visually similar; we kept 256.
- **Latitude rings + meridians** are basic `LineLoop` / `Line` at 0.45
  opacity. Polar bunching is eased by trimming every *odd-indexed*
  meridian to ±80° latitude (`meridianMaxAbsLatDeg`) — the even set still
  goes pole-to-pole unbroken, so 36 galactic lines ease to 18 and 24
  equatorial ones to 12.
- **No pole markers.** Earlier iterations had small + crosses at
  NGP/SGP; they read as visual clutter and were dropped.
- Both spheres track the camera each frame
  (`group.position.copy(camera.position)`), so each conceptually
  represents "the sky from here". Orientation is fixed in absolute space
  — the geometry is already in ICRS — so b=0 / l=0 and α 0h / δ 0° stay
  correctly aimed through any camera move including warp. The IAU boundary
  layer sits on the same sphere and deliberately does **not** track the
  camera: its partition is only true from Sol, so it stays pinned there and
  fades out instead.
- **Chart-mode alpha is the one asymmetry.** `setMonochrome` runs the
  strokes opaque with blending off for the paper aesthetic, which would
  discard a fade entirely — so `setOpacityScale` keeps alpha blending on
  whenever the scale is below 1, in both styles. The scale writes are plain
  uniform assignments; the blend-state reconfigure (a program recompile via
  `needsUpdate`) fires only when the sphere crosses into or out of being
  faded, never per frame.

### The equatorial sphere is Sol-only

Declination is measured from Earth's rotational axis and right ascension
from the vernal equinox, so — unlike galactic coordinates, defined by the
Milky Way's actual disc plane and centre and therefore meaningful from
anywhere in the galaxy (CLAUDE.md § Camera-anywhere perception) — the RA/Dec
frame carries no meaning away from the solar system. So its spec is the only
one carrying a `fadeWindow` — `EQUATORIAL_FADE_WINDOW_PC` = **0.4 pc → 2.0 pc**,
run through `solFrameFadeFactor`: full strength across the whole solar system,
gone before the first star.

The boundary layer's magnitude-keyed quantile table is deliberately **not**
reused: its criterion (a star reading as misplaced relative to its cell
*wall*) has no analogue for a frame grid, which has no walls. Both land in the
same band anyway. And note what does *not* fade — the sphere is camera-tracked,
not Sol-pinned, and RA/Dec axes are fixed in absolute space, so the geometry
stays correctly aimed from anywhere. The fade is a *relevance* boundary.

`coordSphereFadeAt(frame, distFromSol)` is the alpha — 1 for a frame with no
window — and `coordSphereReachableAt` is *defined as* "that alpha > 0", not a
second threshold that could drift from it. `Stellata` binds both to the live
frame as `coordSphereFade` / `coordSphereReachable`.

**`coordSphere` never names a sphere that can't draw.** The layer's update owns
the gone-at-zero-alpha cut outright — it is the single place that acts on it —
and deselects the sphere (`setFilter({ coordSphere: 'none' })`) on the frame
the camera leaves the window, once, since the demotion clears its own trigger.
The sphere objects have no distance logic of their own: they take the alpha the
layer hands them, so there is no second visibility rule to keep in step.

Without the demotion the panel's stop would sit highlighted *and* disabled,
reading as nothing selected. So travelling out and back does **not** restore the
sphere: deliberate, and the same shape as chart mode auto-clearing on
observe→navigate. The affordances then only have to block *entering* the state
— `S` skips the stop (`nextCoordSphereFrame`), the panel disables it. That
disabled flag rides `'frame'` with a cached boolean, not `syncFromFilter`,
since camera distance is what changes and no state event announces it.

**Grid orientation labels** (`coord-sphere-labels.ts`) — SVG `<text>` under
`#gal-grid-labels` / `#eq-grid-labels`, one pool per sphere, pooled once (one
per line) and positioned + rotated each frame. `main.ts` passes each pool a
`groupOpacity` closure — **an alpha, not a boolean**: 0 hides the group, and
anything below 1 lands on the group's `opacity` so the equatorial labels dim
in step with the lines they annotate (a boolean would leave mid-fade text
crisp over a nearly-gone grid). At full strength the attribute is *removed*
rather than set to `1`, so the galactic grid keeps exactly the CSS alpha it
always had. Both groups hide in warp via `body.warping #overlay`.
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
