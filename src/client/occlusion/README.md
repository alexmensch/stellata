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
  occlusion-pure.ts (+ test)   sphereHidesPoint — the angular test,
                               pure and vitest-pinned.
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

## What a sphere cannot answer

The test is a sphere against a point, and both halves are
approximations with a stated cost:

- **The occluder is a sphere.** Saturn's rings, an oblate limb and an
  irregular cloud silhouette are not, so a label within a body radius
  of the true silhouette can resolve either way. The error is bounded
  by the body's own oblateness (Saturn, 0.098, is the worst case in the
  model) and shows as a label appearing a little early or late at the
  limb.
- **The anchor is a point.** For the silhouette-anchored families
  (`../ui/distance-gated-label.ts`) that point is the support sample the
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
