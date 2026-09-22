# WebGPU renderer

The renderer the app boots: the capability route, the async
`WebGPURenderer` boot, what it draws, and the rules a layer lands under
(output colour space, import boundary, early-z, timestamps). The
authoring scaffolding it builds *with* is `tsl/`. Only the entry-bundle
members reach a browser that cannot run it (§ Import boundary).

## Files in this area

```
src/client/webgpu/
  boot-route.ts (+ test)            resolveBootRoute — gate page or
                                    renderer, off the capability probe and
                                    the gate's dev switch. In the entry
                                    bundle (§ Import boundary).
  chrome-lines/                     The line overlays' strokes — solid
                                    and dashed, over three's own line
                                    fragment — its own README.
  gate/                             The user-facing "requires WebGPU" page,
                                    shown on a failing capability verdict,
                                    and its dev switch. Outside the import
                                    boundary by necessity — its own README.
  seam.ts                           WebGpuSeam — the type-only contract the
                                    integration shell holds on this boot,
                                    and the StellataRenderer alias.
  seam-mock.ts                      WebGpuSeam test double: every member
                                    present, each one a refusal by name
                                    until a suite overrides it.
  boot-webgpu.ts                    Async boot: construct + init the
                                    WebGPURenderer, build the seam handle.
                                    The dynamic-import boundary.
  reversed-depth-sort.ts (+ test)   Render-list comparators countering
                                    r185's reversed-depth list reversal;
                                    retire with the three bump.
  timestamps/                       The boot probe that settles whether
                                    this backend's GPU clock can be
                                    trusted, and the resolve cadence —
                                    its own README.
  star-attribute-roster.ts          Which per-star field feeds which
                                    storage table — interleaved into the
                                    static record, or forwarded live off
                                    the shell's array. `stat`,
                                    `forwardedAttribute` and both source
                                    builders are typed over these, so a
                                    field the graph reads without a roster
                                    entry fails to compile;
                                    star/star-tables.test.ts pins that
                                    neither roster silently shrank.
  tonemap-tsl.ts                    TSL mirror of stellata_tonemap's
                                    undithered operator and the sRGB
                                    transfer pair, over tonemap-pure's
                                    constants.
  emission-tsl.ts                   TSL mirror of the emission unit's
                                    point-source peak, flux-peak,
                                    statistic and occluder texel rules.
  perceptual-disc-tsl.ts            TSL mirror of the
                                    stellata_perceptual_disc chunk (dM
                                    knee, √Δm size, exponent, profile).
                                    Shared by the star field and the
                                    planet glare, exactly as the GLSL
                                    chunk is.
  tsl/                              The TSL authoring layer every port
                                    child builds on: the shared uniform-node
                                    mirror, the typing shim, attribute
                                    packing, and the test pattern a ported
                                    layer is covered by — its own README.
  fresnel-shell/                    The boundary-shell surface shared by
                                    the heliopause and the Local Bubble —
                                    its own README.
  dust/                             The dust-particle sprite, whose layer
                                    is shelved — its own README.
  molecular-clouds/                 The cloud absorption raymarch (both
                                    tiers) and the rim shell — its own
                                    README.
  local-group/                      The two instanced volumetric emission
                                    raymarches — its own README.
  milkyway/                         The band's disc + bulge march (and a
                                    never-drawn chart isobar branch) — its
                                    own README.
  extended-emitter-tsl.ts           The write tail every extended-source
                                    emitter shares: column → gain → all
                                    three attachments, and the inline
                                    operator off-target.
  extinction/                       The camera→star dust raymarch as a
                                    compute kernel, and the per-star A_V
                                    buffer that feeds the star vertex
                                    stage — its own README.
  star/                             The star layer: star-indexed storage
                                    tables, the compaction kernel, and the
                                    three depth-honest pipelines (D2 glow,
                                    D3 core mask, D4 disc) drawn indirect
                                    at survivor count, plus the MRT write
                                    side — its own README.
  solar-system/                     The planet mesh, ring annulus,
                                    atmosphere shell, reflected glare and
                                    probe glyph — its own README.
  hdr/                              The HDR chain on this backend: MRT
                                    target, summation, resolve, reduction
                                    readback, and the output-struct form
                                    of the attachment gate — its own
                                    README.
```

## The renderer is WebGPU

**There is one renderer, and no fallback.** `resolveBootRoute` settles
every load before the catalogue is fetched: a browser passing
`detectWebGpuSupport` boots, and one failing it gets the gate page
instead of a dead canvas (`gate/README.md`). A `bootWebGpu` that returns
null after a *passing* probe — `init()` rejected, the renderer dropped
`reversedDepthBuffer`, or the device allows no vertex-stage storage
buffer (`tsl/README.md` § Storage attributes) — lands on the same page
with the `no-adapter` advice. Each of the three is a capability the
probe's `requestAdapter` cannot see, so refusing the boot is the only
thing between them and a black canvas.

The gate's `#webgpu-gate` dev switch is the only fragment the boot reads,
and it rides the **URL fragment** for a reason worth keeping if anything
else ever joins it: `util/url-state`'s writers replaceState the address
bar on every state change, dropping query and fragment alike — they
re-append `location.hash` verbatim (`util/url-state/README.md`
§ Transport), and the fragment is the one slot that is *not* URL state.
A query param would re-introduce query emission into a transport that
deliberately retired it, and `resetJunkUrl` would need an exemption for
it.

## What this boot draws

**The whole app.** Every CPU subsystem (catalog, star frame, focus,
picker, typeahead, URL state, overlays, HUD, render gate) is
backend-blind, and the renderer draws the shell's one scene
(§ One scene per boot). The star layer (`star/README.md`) carries
all three depth-honest pipelines plus their local-mirror clones, dust
extinction on both tiers, and chart mode. The
solar-system family (`solar-system/README.md`) draws whole: glare
billboards and probe glyphs in the main pass, the spheroid mesh, ring
annulus and atmosphere shell in the local depth pass, which runs on
this boot as a single reversed-z bracket (K = 1 —
`../local-depth/bracket/README.md` § Decision), and its line layers —
orbit rings, binary orbit paths and probe trails — through the chrome
line seam (`../chrome-lines/README.md`).
Both boundary shells draw too — the heliopause and the Local Bubble,
through `fresnel-shell/` — as do the molecular clouds
(`molecular-clouds/`), whose absorption is the first ported layer that
*dims* the target rather than adding to it, and both volumetric
emitters — the Local Group's glow (`local-group/`) and the Milky Way band
(`milkyway/`), which write the diffuse attachment the resolve convolves. The dust sprite (`dust/`)
is ported as well, though its layer is shelved at strength 0 so nothing
of it is visible without a console call.
Every remaining line overlay draws too — the galactic disc, both
coordinate spheres, the constellation figure, the IAU boundary arcs and
the Local Group wireframe — each on the chrome line seam, the equator
through its fat stroke (`../chrome-lines/README.md`).
The HDR chain runs for real through `hdr/` — MRT target, summation,
resolve, exposure reduction — behind the `HdrSeam` interface
(`../hdr/hdr-seam.ts`).

### One scene per boot

The shell builds THE scene; the seam owns none, so a new layer cannot
land in a graph nothing renders. `scene.add(group)` is the call site, bar
the star layer and the planet glare, which take the scene as an argument
(`attachStarLayer` / `attachPlanetGlare`) and parent their own meshes.

**Nothing reachable from that scene may carry a GLSL material.** The
graph every layer builds into is now the graph the renderer draws, so a
`ShaderMaterial` there fails WGSL pipeline creation and one invalid
pipeline discards the whole submit — a black app, not a missing layer
(`../chrome-lines/README.md` § Why a seam at all).
`scene/glsl-residents-pure.ts` walks the scene once on the first rendered
frame and names any offender on the console; it is the only thing between
a mis-parented material and a silent black frame.

`scene/glsl-residents-pure.ts` keeps its place with no `ShaderMaterial`
left in the tree: it is what catches a re-introduction, and the walk runs
once on the first rendered frame.

The dust voxel volume streams and uploads through
`loaders/README.md` § Dust voxel upload; the star vertex stage's
fallback march and the extinction prepass (`extinction/README.md`) are
its first WebGPU samplers, and the band's measured stack joins them at
`0it.5`. It was ported first on purpose, since each of those is
smoke-blind without dust in the texture, and because no pixel could
confirm the upload it is verified numerically instead:
`stellata.verifyDust()` reads voxels back off the GPU and compares them
against the chunk files (`loaders/README.md` § Dust voxel readback). A
port child whose layer renders nothing on the WebGPU boot should run it
before suspecting its own shader.

### Who releases what

Three tiers, and a new allocation has to pick one:

- **Per-layer.** Everything `attach*` builds comes back behind a handle
  whose `dispose()` also severs the MRT registration — a dead layer that
  keeps taking output-mode swaps is the failure that shape prevents.
- **Boot-scoped.** Resources `bootWebGpu` builds once and hands to
  several layers: today the extinction slots
  (`extinction/README.md` § One owner for every shared slot). `WebGpuSeam.dispose()`
  is the *only* path that frees these, and the shell calls it after every
  layer and the prepass, since those hand their slots back to the
  placeholders it then releases. A boot-scoped allocation added without a
  line there is unreachable by any teardown.
- **Shell-held.** The renderer and the HDR pipeline are seam fields the
  shell also holds as its own (`renderer`, `hdr`) and disposes itself, so
  the seam's dispose must NOT touch them — it would double-release.

The renderer boots with `reversedDepthBuffer: true` from day 1 — native
[0, 1] reversed clip, depth funcs remapped, clear inverted, all
upstream in three r185 — and `trackTimestamp: true` for the `gpu.frame`
perf row (§ Timestamps). `Depth32Float` is picked automatically for the
CANVAS only; a render target needs an explicit `FloatType` depth
texture (`../local-depth/bracket/README.md` § Precision analysis) — a
request nothing can confirm landed, `hdr/README.md` § The depth format is
requested, not asserted.

## Output colour space — pinned to the working space

The boot sets `renderer.outputColorSpace = LinearSRGBColorSpace` (the
working space), and the pin is load-bearing twice over. Ported shaders
own the whole transfer chain — operator plus sRGB encode — exactly as
the GLSL `RawShaderMaterial`s do, so any renderer-side conversion would
encode their output a second time. And `WebGPURenderer` implements
"output ≠ working" by rendering the whole scene into a hidden
full-resolution framebuffer target and running a fullscreen
colour-transform quad after it (`Renderer._renderOutput`) — an extra
pass plus a drawing-buffer-sized allocation on every frame, invisible in
the scene graph. With output pinned to working, three renders straight
to the canvas and the shaders' encoded values land untouched.

The cost lands on three's **built-in materials**, which relied on that
output transform for their encode: one would render linear-dark on
anything reaching the canvas. Nothing does — every line overlay is on
the chrome line seam, whose single-output graph owns the encode and
selects it on the `uHdrTarget` node mirror, 0 exactly in chart mode
(`chrome-lines/README.md` § The encode the struct graph does not carry). Do not
"fix" a dark built-in by unpinning the output space — that re-breaks
every ported emitter and re-prices the hidden pass; put the material on
the seam instead.

**The clear colour is the second casualty, and no shader can fix that one.**
Chart mode's paper is a `setClearColor` hex, so nothing owns its transfer;
worse, this backend clears with the *working*-space components and never
reads `outputColorSpace` (`Background.update` → `_clearColor.getRGB()` at
its default space). The paper is therefore authored in the space the
renderer clears in — `chart-mode/chart-palette.ts`'s `paperClearColour`,
correct only because output is pinned to working here. A new clear colour
owes the same treatment.

Cross-copy caveat: `three/webgpu` is a second bundled copy of three's
core (§ Import boundary), so app objects built from `'three'` (camera,
vectors, textures) flow into the WebGPU renderer across copies. three
dispatches on `.isX` flags rather than instanceof, and the spike ran a
`'three'`-built LUT texture through both browsers — but treat any
"object not recognised" oddity as a cross-copy suspect first.

## Import boundary — nothing WebGPU in the entry bundle

`three/webgpu` (and `three/tsl`, which re-exports its node system) is a
separate ~1 MB entry that duplicates three's core, and no tree-shaking
removes an eagerly-imported renderer. **The split survives having one
renderer**: it is what the gate is worth. A browser that fails the probe
gets the page without fetching a megabyte of renderer it cannot run, and
that is the same saving the probe-before-catalogue ordering buys. The
rule:

- **Value imports of `three/webgpu` / `three/tsl` live only in this
  folder**, in modules reachable solely through `main.ts`'s
  `import('./webgpu/boot-webgpu')` (Vite code-splits that whole graph
  into an async chunk a gated browser never fetches).
- Modules outside this folder may import from it **statically only for
  `boot-route.ts`, `gate/` and type-only imports** (`import type` is
  erased at compile time and costs nothing). Both run on a browser with
  no WebGPU at all, and the boundary test guards each against acquiring a
  `three/webgpu` import.
- A port child's TSL layer module is therefore also loaded dynamically
  — construct it through the seam, never `import` it from `stellata.ts`.
- **A `*-mock.ts` here is held to the OUTSIDE rule**, not the folder's: it
  may type-import only. That is what lets a suite anywhere import it —
  a double carrying no `three/webgpu` value import costs the entry bundle
  nothing, and the sweep checks it rather than exempting it.

`tests/webgpu-import-boundary.test.ts` scans for violations.

Measured at the seam's first build (vite 8 / rolldown): the async chunk
is 649 kB min / 182 kB gz, and its mere existence grows the entry
~31 kB min / ~7 kB gz — ~2.6 kB is the seam wiring itself, the rest is
chunking shape: the entry keeps three.core bindings exported for the
async chunk to share, which is what stops the async chunk duplicating
core (verified by rebuilding with a stubbed, import-free boot module;
no WebGPU identifier appears in the entry either way).

## Authoring a port child — `tsl/`

How app data reaches a TSL graph, and what a ported layer's tests look
like, moved to `tsl/README.md`, which stays the authority: the
uniform-node mirror's reference-vs-sync contract and the texture-slot
exception (§ Shared uniform nodes), the @types/three gaps worth casting
around (§ TSL typing shim), the 8-vertex-buffer limit and the two ways
a population answers it (§ Per-instance data), and the three legs a
ported layer is covered by (§ TSL test pattern).

## Early-z — the star layer's depth-honest redesign

Any static `gl_FragDepth` write disables early-z for the whole draw (in
WGSL: pipeline) and no conservative-depth qualifier exists, so a
defensive write shared across the three star passes would cost all three
their early-z, not just the halo branch needing it. The contract, valid
on any renderer or encoding: one program per pass (compile-time define
replacing `uRenderMode`); glow carries no depth output (removal of the defensive
write is bit-exact); the core-mask member stamp moves to the vertex stage
(per-instance, so clip z pins to the near end of the active depth
convention); the disc pass writes no depth at all, because the core-mask
draw already stamped the same fragments at the same value several
renderOrders earlier (`star/README.md` § The disc draw writes no depth
carries the argument, what it gives up, and the fallbacks).

**The contract is satisfied by removing writes, never by adding draws.**
A port child that answers "one program per pass" with a second draw over
the same 390k instances has made the migration cost more per frame than
the renderer it replaces — which is the one outcome the port is not
allowed to have. Draw count per subsystem is part of parity, alongside
what the pixels look like.

## One writer per buffer per submit

`GPUQueue.writeBuffer` is a queue operation: every write in a frame lands
before any command in that frame's submit executes, so N draws sharing one
buffer, each preceded by a write, all read the *last* bytes and the first
N−1 draw wrong with nothing reporting it. The rule and its remedies —
per-draw buffers, 256-byte dynamic-offset slots, a per-view ring — are
`docs/render-rules.md` § 7.

**Nothing here calls `writeBuffer` directly**, which is what keeps the rule
cheap today: no `writeBuffer` / `createBuffer` / `copyBufferToBuffer` call
exists outside three. Every CPU upload is staged as `BufferAttribute`
update ranges, and the backend turns those into one `writeBuffer` per range
against a *single* `array` reference read at upload time
(`WebGPUAttributeUtils.updateAttribute`) — so the plural writes deposit one
consistent state, and overlapping ranges, which `util/attribute-upload.ts`
accumulates across frames when no render consumed them, carry identical
bytes rather than racing.

**The buffers stellata's own GPU code writes are the extinction A_V
buffer and the star compaction's survivor lists and indirect args**, and
none needs a per-draw slot: each is written by one compute dispatch, in a
compute submit ahead of the frame's render, and every draw in that render
reading it wants the *same* bytes — the A_V cache is one value per star
(`extinction/README.md` § The prepass kernel); the lists are one per tier,
read by the draws of that tier and by nothing else
(`star/compaction/README.md` § The buffer-writer requirements,
discharged). The per-draw slotting of `docs/render-rules.md` § 7 starts
owing the moment a buffer carries a value that differs between draws
sharing a submit, and no buffer here does.

**A storage attribute breaks the upload contract silently.** WGSL has no
packed `vec3` in a storage buffer, so for `itemSize === 3` the backend pads
to 4 — and for a storage attribute alone it *reassigns*
`bufferAttribute.itemSize` and `.array` to the padded copy. Anything
holding the originals then diffs a stride and an array the GPU will never
see. `DirtyItemUploader` caches both at construction and `iPosition` is
itemSize 3; it is correct because that attribute stays a plain vertex
attribute: the star layer reads positions out of an itemSize-1 storage
table over the same array (`star/README.md` § Star tables), and the compute
prepass owns a vec4 position table of its own. No itemSize-3 storage
attribute exists in this tree.

**`DynamicDrawUsage` is a per-render full upload on this backend.**
`Attributes.update` re-runs the upload for an attribute carrying that usage
on every render call whatever its version, and with no pending ranges that
is the whole buffer. The star tables carry the default usage and upload on
version alone; a per-frame-rewritten attribute elsewhere that keeps the
hint pays its full byte count every rendered frame.

**The hint is free only where the writer flags the attribute in EVERY
render call that draws it** — then the upload was owed anyway. One geometry
drawn by N meshes is N render calls against one flag, so the draw count is
the half that bites. The probe markers and trails pass on both: each flags
from the update that settles its visibility, and only one of the main /
local-pass pair is ever visible. The glare billboard dropped the hint
(`solar-system/README.md` § The glare packs); the star mirror's slots keep
it on a size ceiling, not on the rule
(`../star-pipeline/local-pass/README.md` § Mirror draw).

## Timestamps

The renderer boots with `trackTimestamp: true`, and a grant is not proof
the clock works: Safari 26 grants the feature and then discards every
submit, Chrome grants it and resolves negative durations. `timestamps/`
owns the boot probe that settles it and the resolve cadence that keeps
the query pool from overrunning — `timestamps/README.md`.
