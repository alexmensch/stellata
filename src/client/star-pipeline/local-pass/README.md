# Star local-depth pass

The star half of the local depth pass: which stars join the pass each
frame, and the mirror draw that re-renders them inside its depth
bracket. Pass mechanics and the other member layers are
`../../local-depth/README.md`; why the main pass can't do this job is
`../README.md` § Depth encoding.

## Files

- `star-local-mirror.ts` — `StarLocalMirror`: the mirror draw. Owns
  `MIRROR_CAPACITY`, which is tied to the `uLocalMemberIdx` uniform
  array size (pinned in `../star-pipeline.test.ts`). Its disc and glow
  meshes are statistic emitters like the main-pass pair — a member
  collapses in the main pass, so the mirror is the only draw that would
  reach the exposure statistic (`../../hdr/attachments/README.md`). The
  depth-only mask mesh is not, writing no colour anywhere.
- `star-local-cluster.ts` — `StarLocalCluster`: per-frame star
  membership, the `uLocalMemberIdx` slot writes, and the binary
  orbit-path group.
- `star-local-cluster-pure.ts` — `isResolvedDiscStar` membership
  predicate + `discWindowPc` camera-window bound, shared with the
  core-mask gate via `RESOLVED_DISC_MIN_PX`. `PHYS_RATIO_THRESHOLD`
  mirrors `star.frag.glsl`'s disc/glow split, and `isDiscDominant` is
  that split as a predicate — the **one** CPU mirror of it. Membership
  above is `isDiscDominant` plus the size floor; the star pick gate
  (`../../camera/controls/star-pick-visibility-pure.ts`) reads it
  through `../star-pass.ts`'s `colourPassFor` for both its taper flag
  and its glow-pass-only eclipse dim.
- `star-local-mirror.test.ts` — mirror geometry + per-frame slot sync.
- `star-local-cluster.test.ts` (+ `-pure.test.ts`) — membership pins.

## Mirror draw

A member star's main-pass instance collapses (`uLocalMemberIdx`, an
int array of `MIRROR_CAPACITY` slots checked in all three passes) and
`star-local-mirror.ts` re-renders it in the local depth pass: a small
instanced geometry whose slots re-copy the member's attributes from
the live source arrays each frame, drawn with `LOCAL_DEPTH_PASS`
material clones sharing the same uniform objects. Under that define
the shader swaps `gl_InstanceID` for the `iSourceIdx` attribute
(`STAR_SELF_ID`) so star-indexed lookups — the extinction texelFetch,
`uHideFocusIdx`, `uPinFocusToCenter` — behave identically. The
attribute-budget invariant: each compile variant must fit within 16
attributes (the WebGL2 guaranteed minimum). Pinned per-variant in
`../star-pipeline.test.ts`, along with the uniform-array-size ↔
`MIRROR_CAPACITY` tie.

## Membership

`star-local-cluster.ts` unions three triggers per frame: the active
planet-system host (reported by `SolarSystemCluster`), the focal star's
Kepler chain — the whole chain engages as soon as its orbit paths draw
or any member resolves as a disc, so a glow-sized companion transiting
a resolved primary depth-tests instead of being over-painted — and a
camera-window scan for any resolved-disc star (`isResolvedDiscStar`:
disc-pass split × `RESOLVED_DISC_MIN_PX`, evaluated on the
`renderedSizeComponents` CPU mirror). The scan window reuses the
core-mask gate's sorted-distance walk
(`StarFrame.forEachStarNearCamera` — `../frame/README.md`).

Membership parks entirely while the local depth pass is not rendering
(`localPassLive: false` — the WebGPU boot until its port child,
`../../webgpu/README.md` § Every park is a gate): a member's collapse
is only honest while the mirror repaints it, and that boot's
reversed-z float32 main-pass depth orders resolved discs natively
meanwhile.

## Core opacity is depth-gated, never paint-over

The disc pass blends with per-channel MaxEquation, which cannot cover
anything brighter in any channel — a white background glow survives
"under" a warm core repaint. So occlusion always works by keeping
occluded fragments from painting at all:

- **Main pass** — a member keeps its core depth-mask draw (only the
  colour passes collapse; `vLocalMember` in the shaders) and the mask
  stamps `gl_FragDepth = 0.0`. The member's true standard depth
  quantises to 1.0 past ~7 AU and would TIE background glow instead of
  occluding it; the nearest-possible stamp is safe because the local
  pass repaints the core and membership range (a ≥5 px disc)
  guarantees nothing renderable sits between camera and disc. The
  shell ORs `starLocalCluster.hasMembers()` into the core-mask mesh
  gate so an appSize-driven member disc outside the physSize window
  still stamps. `vLocalMember` is per-instance, so the WebGPU port
  moves this stamp to the vertex stage as a clip-z pin and the draw
  regains its early-z — `../README.md` § Early-z.
- **Local pass** — the mirror carries a third depth-only core-mask
  mesh (in-pass renderOrder −1, before the disc mirror) so an occluded
  member core depth-fails against the front core's bracket depth
  before the blender runs — no purple max-blend of two overlapping
  cores.

The halo annulus stays translucent: background stars paint there in
the main pass and the mirrored halo MaxEquation-blends over them —
brighter stars peek through, dimmer ones wash into the glare.
