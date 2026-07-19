# Local depth pass — close-range inter-body occlusion

A camera-relative second render pass that gives close bodies (moons,
planets, rings, close binary pairs, future probes) true z-buffer
occlusion the main pass cannot provide. The main pass keeps its
whole-universe logarithmic depth; this pass re-renders the active
local system over the finished frame in tight standard-depth brackets
where the z-buffer resolves everything natively.

This README is the design record for the primitive (stellata-shvs):
architecture, precision analysis, cluster API, and migration plan.
The reusable core is `slice-pure.ts` + `local-depth-pass.ts`; the
planet mesh LOD (spheroid meshes + ring annuli) renders through it
unconditionally (migration step 1 — its shaders carry no log-depth
chunks and the ring shader's analytic body-occlusion discard is
gone).

## Files

- `slice-pure.ts` — member bounding spheres → K ratio-bounded
  [near, far] depth slices; the precision constants and quantum math.
  Vitest-pinned (`slice-pure.test.ts`), including the headline
  scenarios below.
- `local-depth-pass.ts` — `LocalDepthPass`: owns the local scene,
  cluster registration, and the per-frame slice loop
  (`clearDepth` + bracketed render, far→near).

## Why the main pass cannot do this

The renderer's log-depth encoding (`log2(1+w) / log2(1+far)`, `w` in
pc) is logarithmic only for `w ≫ 1`. Every intra-system distance is
`w ≪ 1 pc`, so the buffer sits in its *linear* regime: one depth
quantum ≈ `ln(1+far)/2²⁴` ≈ 7e-7 pc ≈ **0.14 AU**. Planet↔planet
ordering (AU apart) barely resolves; moon↔parent, ring↔body, and
close-binary separations (≪ 0.01 AU) land inside a single quantum and
z-order as frame-to-frame float noise. See
`../star-pipeline/README.md` § Depth encoding.

Every analytic workaround (disc silhouette clip, ray-sphere occlusion,
the orbit-ring corrupt/restore dance, ring-shader ray-ellipsoid
discard, `iDepthBias`) is a pairwise special case that breaks physical
reality somewhere — the apparatus this primitive deletes.

## Architecture

Canonical space-sim depth-range partitioning (KSP local/scaled space,
Celestia, Outerra), generalised:

1. **Main pass** — unchanged. Log depth, `near 1e-10 / far 1e5 pc`.
   Paints the universe: stars, MW, grids, and the *far regime* of
   every body (sub-pixel / disc-LOD billboards of systems with no
   active cluster).
2. **Local pass** — for each active cluster: `autoClear = false`,
   then per depth slice far→near: `clearDepth()` (colour kept),
   camera near/far set to the slice bracket, standard (non-log)
   depth, render the cluster's renderables. The z-buffer then handles
   ALL close-range occlusion natively: oblate limbs, moon↔planet,
   moon↔moon, ring↔body, transits, binary pairs.

Compositing local over main by painter's order is safe because
nothing renderable in the main pass sits between the camera and a
local body — the nearest non-member object is parsecs away.

### Full membership — billboards render in the local pass too

Membership is **per system, per body, regardless of LOD**. When a
cluster is active, *every* body of that system draws in the local
pass — spheroid meshes AND billboards (the host star's disc/glow, a
sub-pixel moon's glow) — and their main-pass instances collapse via
the star/planet pipelines' existing clip-space-sentinel machinery.

Depth proxies (stamping billboard depth but leaving colour in the
main pass) were rejected: a sub-pixel moon transiting *in front of*
its mesh-LOD parent would be over-painted by the parent (main-pass
colour, local-pass mesh), erasing the transit. With full membership
the moon's billboard depth-tests against the parent mesh and wins.
The same argument gives close binary pairs native disc ordering,
retiring `iDepthBias`.

Billboards use small **mirror draws**: a per-pipeline
`InstancedBufferGeometry` holding only the cluster members (per-frame
attribute copy of a handful of instances, plus an `iSourceIdx`
indirection for star-indexed texture reads like the extinction
prepass), sharing the main pipeline's uniform objects (the
`perceptual-disc-uniforms.ts` pattern) with cloned materials that set
`LOCAL_DEPTH_PASS`.

### Local-pass materials carry NO log-depth chunks

Fragments in the local pass must keep standard `gl_FragCoord.z` from
the bracketed projection matrix — including the three.js
`logdepthbuf` chunks would encode depth against the renderer-wide far
plane and destroy the bracket's precision. Shaders that render *only*
here (planet mesh, ring annulus) simply omit the includes; shaders
shared with the main pass (the billboard mirror draws of step 2) wrap
them in `#ifndef LOCAL_DEPTH_PASS` and their local-pass material
clones set that define.

### Depth slices — unconditionally correct painter's partitioning

One bracket cannot span a metre-scale probe (near ~0.3 m) and
Saturn's rings at 10⁵ km. `computeDepthSlices` therefore splits the
members' depth range into K equal-ratio slices, each within
`maxSliceRatio`, rendered **far→near with `clearDepth` between**.

- **Correctness needs no gaps.** A fragment farther than another can
  never land in a strictly nearer slice, so far→near painting with
  per-slice z-tests reproduces global depth ordering exactly.
  Geometry spanning a boundary (an orbit ring) simply draws in every
  slice; the slice near/far planes clip-partition its fragments, and
  the union is the complete primitive with correct per-slice depth.
- **Cost** is one extra render of a small scene per slice. K = 1–2
  for mesh-only brackets, ~4 when an orbit-ring bound contains the
  camera (near floors at `NEAR_MIN_PC`); the probe era needs no new
  machinery. Refinement hook if K ever matters: let a member report a
  true nearest-approach distance instead of the conservative
  centre−radius when the camera is inside its bound.
- **Seam artefacts:** a fragment exactly on a boundary is measure-zero
  (float equality); no visible seam is expected. Verify in smoke; an
  epsilon overlap is the fallback if one ever shows.

## Precision analysis

Standard perspective depth quantum at distance `z` in `[near, far]`
(24-bit buffer, the WebGL2 default renderbuffer):

```
δz(z) = z²·(far − near) / (far·near·2²⁴)   ⇒   δz(z)/z ≤ (far/near)/2²⁴
```

A feature of physical size `s` at distance `z` is z-orderable iff
`s > δz(z)`, i.e. iff its angular size exceeds `(far/near)/2²⁴` rad at
the slice's far edge. Setting

```
maxSliceRatio = 2²⁴ · (fovY/viewportH) / SLICE_RATIO_SAFETY    (SAFETY = 4)
```

makes the smallest orderable feature at the far edge subtend **¼ px**
— everything the user can see is orderable, with margin growing
linearly toward the near plane. The bound adapts to FOV: zooming to
10° tightens the ratio (more slices), 120° relaxes it. At the default
50° / 1080 px view, `maxSliceRatio ≈ 3389`.

Pinned scenarios (`slice-pure.test.ts`):

| Scenario | Bracket | Result |
| --- | --- | --- |
| Saturn + rings from Mimas' orbit floor | 181 km → 342,000 km | 1 slice; quantum ≪ any body |
| … stretched to Titan | 181 km → 1.29e6 km | 2 slices |
| Uranus limb from Miranda's orbit floor | 165 km near, Uranus at 129,900 km | δz ≈ 6 km ≪ R = 25,559 km |
| Full system incl. Neptune's orbit ring | 0.3 m → 41.8 AU | 4 slices |
| Metre-scale probe near Saturn | 0.3 m → 41.8 AU | 4 slices |

**Rejected encodings** (decision record):

- *Reversed-Z* — best-in-class, but needs a three.js upgrade
  (`reverseDepthBuffer`, r166+) + `EXT_clip_control` gating with a
  fallback path, for headroom the slice bound already guarantees.
  The escalation path if a future case breaks the ¼-px budget.
- *Local log depth* — with a tight far it degenerates to linear-in-w
  (uniform quantum `far/2²⁴`), which *fails* the small-moon case the
  moment far is generous (quantum 357 km at far = 40 AU vs Miranda's
  235 km radius). Standard depth's z² falloff concentrates precision
  exactly where bodies resolve.

## Cluster API

```ts
interface MemberSphere { distPc: number; radiusPc: number; }

interface LocalCluster {
  readonly group: THREE.Group;   // parked in the pass scene while registered
  collectSpheres(camera: THREE.PerspectiveCamera, out: MemberSphere[]): void;
}

localDepthPass.register(cluster): () => void   // unregister
localDepthPass.render(renderer, camera)        // after the main render
```

- `collectSpheres` runs per frame; appending nothing marks the
  cluster inactive (the pass no-ops, zero cost). Spheres cover every
  local-pass renderable: body meshes, billboard members, ring annuli,
  orbit-ring extents (host distance + aphelion).
- Multiple clusters compose: sphere lists merge into one slice
  partition. In practice at most one system is ever super-pixel-close;
  the API just doesn't care.
- Positions are renderer-local-frame (same floating origin as the
  camera), so brackets are camera-relative distances and the pass is
  invariant under `recenterOrigin` — no recenter hook needed beyond
  what each layer already does.

Planned providers:

- **solar-system** — the planet/moon mesh LOD + ring annuli (spike,
  live), then billboard members + host star mirror draws, planet +
  moon orbit rings.
- **binaries** — the focal star's slot-chain pairs: star-pipeline
  mirror draws for both members + `BinaryOrbitPathLayer` ellipses.

## Pass composition rules

Within one slice, standard three.js ordering applies: opaque
depth-writers first (meshes, disc cores), then transparent
depth-tested non-writers (ring annuli, orbit-ring lines, additive
glow). No core depth-mask is needed in the local pass — there are no
background layers here to pre-fail; the disc pass's own core depth +
halo `gl_FragDepth = 1.0` convention carries over unchanged. The
corrupt/restore pair does not carry over — it exists only because the
main pass's depth can't order ring vs body, which is the problem this
pass solves.

## Interactions

- **Disc↔mesh crossfade** — until step 2 lands, the fading disc
  (main pass) and the rising mesh (local pass) composite across the
  pass boundary — smoke-validated on Saturn. Under full membership
  both render in the *same* pass with their existing blend contract
  (`mesh-crossfade.ts`), so the handoff tightens further.
- **Chart mode** — inert. Chart flattens bodies to ink discs with
  depth disabled; the mesh layer already hides in monochrome and
  member suppression must not engage (billboards render normally in
  the main pass).
- **Warp** — the pass keeps running (fly-through realism), same as
  the planet layers.
- **Observe** — `uHideIdx` / `hiddenInstanceIdx` (the observe-anchor
  hide) applies to mirror draws exactly as to main-pass instances.
- **SVG overlays** — a separate compositing channel, always above
  WebGL; camera near/far changes don't touch x/y projection, so overlay
  math is untouched. The constellation figure is now WebGL line geometry
  in the main pass (`../constellation-figure/README.md`), so the local
  pass's repaint occludes it with a body's true silhouette like any
  background — no mask.
- **Eclipse photometry** — `iEclipseDim` survives unchanged: it is
  the *photometric* signal for sub-pixel overlaps, which no depth
  buffer can provide. `iDepthBias` (the geometric half) retires once
  binaries migrate.
- **Extinction prepass** — mirror draws read the same star-indexed
  A_V texture via `iSourceIdx`.

## What this deletes

Ring-shader analytic body-occlusion discard (done, step 1) ·
orbit-ring corrupt/restore depth passes (`uRenderMode` 3/4,
renderOrders 1.5/2.5 — step 2) · `iDepthBias` + its
EclipsePhotometryField wiring (step 4) · the reverted PR #252
apparatus stays deleted (disc silhouette clip, mesh ray-sphere
occlusion, iOccluder/familyOccluders).

## Migration plan (implementation children)

1. **Mesh LOD + ring annuli by default** — DONE: the mesh layer's
   group lives in the pass scene from construction, its shaders carry
   standard depth only, and the analytic occlusion discard is gone.
2. **Planet billboard members + host star mirror draw; full main-pass
   member suppression** (extend the sentinel to collapse disc + glow
   + core mask for members); delete corrupt/restore.
3. **Orbit rings (planet + moon) into the pass** — extents join
   `collectSpheres`.
4. **Binaries migration** — focal-chain star mirror draws +
   `BinaryOrbitPathLayer`; delete `iDepthBias`.

Each step is independently shippable and visually verifiable; the
order minimises the window where two occlusion mechanisms coexist.

## Current wiring

The shell registers the planet mesh LOD as a cluster at construction
(`PlanetMeshLayer.group` parked in the pass scene;
`collectSpheres` reports mesh-visible bodies) and calls
`localDepthPass.render` after every main render — a no-op frame when
no body is in mesh range. Perf label: `gpu.localDepth`.

Smoke (Saturn + moons): focus Saturn, scrub time; check ring↔body
occlusion incl. the oblate limb (the analytic path's polar-gap bug
must not reappear), moon-mesh↔Saturn-mesh ordering on close passes,
no popping through the disc↔mesh crossfade band, and no z-artefacts
when Titan stretches the bracket to two slices.
