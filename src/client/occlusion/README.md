# Label occlusion — the near-body set the SVG layer reads

An SVG label has no depth relationship to the canvas under it
(`../README.md` § Full render stack: "There is no z-ordering between
WebGL and SVG"), so nothing the GPU knows about depth reaches a
`<text>` element. This folder is the CPU answer: a per-frame set of
near solid bodies, and one angular test asking whether any of them
hides a label's anchor.

## Files

```
src/client/occlusion/
  occlusion-pure.ts (+ test)   sphereHidesPoint — the angular test — and
                               spheroidHidesPoint over it, both pure and
                               vitest-pinned.
  occluder-set.ts (+ test)     OccluderSet — the per-frame publish /
                               query surface; OccluderQuery is the read
                               half a label surface takes.
```

## Who publishes into it

The set is exactly **the solid bodies the local depth pass draws**, and
it is published by the same two clusters that decide that membership:

- `../solar-system/local-cluster.ts` — every body of the active host,
  plus the host star itself.
- `../star-pipeline/local-pass/star-local-cluster.ts` — each member
  star's disc.

Those clusters are the right providers because the local pass's own
compositing argument already establishes what this test needs:
**nothing renderable in the main pass sits between the camera and a
local body** (`../local-depth/README.md` § Architecture). A body that
is not a pass member is parsecs away and sub-pixel, and occludes
nothing.

**Only solid bodies enter the set.** The clusters also report
ring-extent, orbit-path and probe-trail spheres to the bracket
partition; those are line geometry spanning a whole system, and one of
them in this set would blank every label inside an orbit's radius.
`collectSpheres` (the bracket's input) and the occluder publish are
therefore separate walks over the same membership, not one shared list.

The shell clears the set immediately before the scene-layer fan-out and
the overlays read it on `'frame'`, which fires after the render — so a
label reads the current frame's bodies (`../README.md` § Event bus).

In chart mode both clusters park, so the set is empty and no label is
occlusion-gated. Chart is a flat schematic with depth disabled; its
label gating is magnitude and collision
(`../chart-mode/labels/README.md`).

## The far-surface rule

`sphereHidesPoint` requires the anchor to clear the occluder's **far**
surface — `dAnchor > dOccluder + radius`, not `dAnchor > dOccluder`.
Two things depend on it:

- A body never hides its own label. Every labelled body is in the set,
  and its anchor sits at its own centre, so a centre-plane test would
  hide every label in the model.
- A body straddling another's limb keeps its label instead of
  flickering as its depth crosses.

A camera at or inside an occluder's surface returns no verdict at all:
the resolved surface fills the viewport there, and the label is the
smaller problem.

## A publisher states the shape it draws

**`add` does not exist; there is no way to publish a body without saying
what shape it is.** `addSpheroid` takes the body's equatorial radius, its
polar radius as a fraction of that, and its pole; `addSphere` is that at
ratio 1, and its docstring says so as a claim — *this body is round at
every camera angle* — because that is what a caller is asserting.

The hole this closes: a bare `add(x, y, z, radius)` cannot express a
squashed body, so a planet publisher had no choice but to supply a
stand-in, and nothing at the call site showed it. Both publishers then
reached for a radius already in hand for the depth bracket — which wants
a deliberately generous bound, the opposite of a drawn silhouette. A
bracket bound and a drawn radius are both `number`, which is why the
substitution was invisible; the shape argument is what separates them.

So a publisher's radius **must come from the code that draws the body**,
never from whatever is nearby:

- **Planets and moons** take `polarRadiusRatio`
  (`../solar-system/planets/spheroid-pure.ts`) — the one source of
  `1 − f`, shared with the mesh's own `scale.y / scale.x`, the ring
  shader and the atmosphere march. Below the mesh crossfade band only the
  round glare billboard draws, so `SolarSystemCluster` publishes a sphere
  there and a spheroid above it, off `PlanetMeshLayer.drawnPoleInto`.
  Pinned in `../solar-system/local-cluster.test.ts` against
  `polarRadiusRatio` itself, so the test moves with the drawing code
  rather than freezing a number beside it.
- **Stars** take the live pulsation radius
  (`../camera/controls/star-physics.ts:livePulsationRadiusFactor`), not
  `peakAmplitudeFactor`. That one holds a variable at its largest across
  the whole cycle — right for a bracket or a fade envelope, and at
  maximum light a Mira's peak is ρ = 1.4× the disc on screen.

`spheroidHidesPoint` is **exact for a squashed body**, not a closer
approximation to one: scaling the pole component of camera and anchor by
`1 / polarRatio` (`../util/polar-scale.ts`) carries the spheroid onto its
equatorial sphere and every sight line onto a sight line, so the verdict
survives the map and `sphereHidesPoint` answers it outright. A round body
short-circuits to that test untouched.

## What the set still cannot answer

- **Saturn's rings are not in it.** They reach well past the body, so a
  ring-extent sphere would blank every label inside the orbit. Leaving
  them out is a claim about what they DRAW rather than a shape
  approximation: the annulus writes no depth and dims what is behind it
  instead of hiding it (`../solar-system/planets/rings/README.md`), so a
  label seen through the rings is still legible and "does a nearer body
  hide this anchor" is honestly answered no.
- **The anchor is a point.** For the silhouette-anchored families
  (`../overlays/distance-gated-label.ts`) that point is the support sample the
  label hangs off, not the object's centre — so the verdict is "is the
  text drawn over a nearer body", which is the question the label
  actually poses. A cloud whose centroid is hidden but whose support
  point is clear keeps its label, correctly: the text is in open sky.

This is deliberately **not** a substitute for the local depth pass.
That pass owns fragment ordering between bodies and does it natively
(`../local-depth/README.md` § Why the main pass cannot do this); the
apparatus it deleted was analytic geometry standing in for a z-buffer
that could have done the job. Here there is no z-buffer to reach: the
SVG layer composites above the resolved frame, so an analytic test on
the CPU is the only instrument available short of moving label text
into WebGL as depth-tested glyphs.
