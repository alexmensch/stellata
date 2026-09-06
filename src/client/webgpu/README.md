# WebGPU dual-boot seam

The boot seam the WebGPU migration lands behind: the renderer flag, the
async `WebGPURenderer` boot, what that boot draws today, and the rules a
port child lands under (output colour space, import boundary, early-z,
timestamps). The authoring scaffolding it builds *with* is `tsl/`. The
shipped WebGL2 app is untouched while the flag is off; nothing here
reaches the WebGL2 bundle (§ Import boundary).

## Files in this area

```
src/client/webgpu/
  renderer-flag.ts (+ test)         Parse #renderer=webgpu|webgl2 and the
                                    #webgpu-gate=<verdict> dev switch from
                                    the URL fragment.
  chrome-lines/                     The line overlays' strokes — solid
                                    and dashed, over three's own line
                                    fragment — its own README.
  gate/                             The user-facing "requires WebGPU" page,
                                    landed dark until the cutover. Outside
                                    the import boundary by necessity — its
                                    own README.
  seam.ts                           WebGpuSeam — the type-only contract the
                                    integration shell holds when the flag
                                    is on. StellataRenderer union type.
  boot-webgpu.ts                    Async boot: construct + init the
                                    WebGPURenderer, build the seam handle.
                                    The dynamic-import boundary.
  reversed-depth-sort.ts (+ test)   Render-list comparators countering
                                    r185's reversed-depth list reversal;
                                    retire with the three bump.
  timestamp-probe.ts (+ test)       Boot-time check that timestamp
                                    queries validate; clears
                                    trackTimestamp where they do not
                                    (§ Timestamps).
  star-attribute-roster.ts          Which star attributes pack, split by
    (+ test)                        upload cadence. The test derives the
                                    partition from the live WebGL
                                    geometry, so a new attribute there
                                    fails CI until this is updated.
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
  extinction/                       The camera→star dust raymarch and the
                                    per-star A_V cache that feeds the star
                                    vertex stage — its own README.
  star/                             The star layer: packed geometry + the
                                    three depth-honest pipelines (D2 glow,
                                    D3 core mask, D4 disc) and the MRT
                                    write side — its own README.
  solar-system/                     The planet mesh, ring annulus,
                                    atmosphere shell, reflected glare and
                                    probe glyph — its own README.
  hdr/                              The HDR chain on this backend: MRT
                                    target, summation, resolve, reduction
                                    readback, and the output-struct form
                                    of the attachment gate — its own
                                    README.
```

## The flag — `#renderer=webgpu`

The flag rides the **URL fragment**, read once at boot by `main.ts`.
Why the fragment: `util/url-state`'s writers replaceState the address
bar on every state change, dropping query and fragment alike — they now
re-append `location.hash` verbatim (`util/url-state/README.md`
§ Transport), and the fragment is the one slot that is *not* URL state,
so the seam costs url-state no renderer knowledge. A query param would
re-introduce query emission into a transport that deliberately retired
it, and `resetJunkUrl` would need a renderer-aware exemption.

Consequences that make the A/B smoke work:

- Composes with a share blob: `/v/<blob>/#renderer=webgpu`, and with
  the legacy query form `/?v=<blob>#renderer=webgpu`.
- Survives refresh, camera moves, share-link apply, and the junk-URL
  reset.
- Parity smoke is "same `/v/<blob>/`, add or drop the fragment, reload"
  — editing only the hash does not reload; hit reload yourself.
- `#renderer=webgl2` parses too: it is the explicit escape hatch the
  cutover keeps for one release after WebGPU becomes the default.

If WebGPU is unavailable or `renderer.init()` rejects, `bootWebGpu`
returns null and `main.ts` falls back to the shipped WebGL2 boot with a
console warning — the flag is a dev seam until the cutover. The
user-facing "requires WebGPU" gate page is built and lands dark in
`gate/`, reachable only through `#webgpu-gate=<verdict>`; `0it.13` is what
puts it on a real capability verdict.

## What the flag boots today

The **star field and the solar system's main-pass surfaces, with the full
app alive**: every CPU subsystem (catalog, star frame, focus, picker,
typeahead, URL state, overlays, HUD, render gate) runs identically; the
renderer draws the seam's own scene (`WebGpuSeam.scene`), which gains
layers as port children land. The star layer (`star/README.md`) carries
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
resolve, exposure reduction — behind the same `HdrSeam` interface the
WebGL pipeline implements (`../hdr/hdr-seam.ts`). The shell's WebGL
scene still exists and is never rendered on a WebGPU boot — no
per-layer gating, no material ever reaches the wrong backend.

**A ported layer has to move scenes, and nothing warns if it does not.**
A layer built into the shell's scene renders on WebGL and silently
nowhere on WebGPU, so every material swap pairs with
`(webgpu?.scene ?? scene).add(group)` at its call site — the probe
markers, both shells and the dust sprite all read that way.

The dust voxel volume streams and uploads on both backends
(`loaders/README.md` § Dust voxel upload); the star vertex stage's
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
  several layers: today the extinction texture slots
  (`extinction/README.md` § Two nodes, one owner). `WebGpuSeam.dispose()`
  is the *only* path that frees these, and the shell calls it after every
  layer and the prepass, since those hand their slots back to the
  placeholders it then releases. A boot-scoped allocation added without a
  line there is unreachable by any teardown.
- **Shell-held.** The renderer and the HDR pipeline are seam fields the
  shell also holds as its own (`renderer`, `hdr`) and disposes on either
  backend, so the seam's dispose must NOT touch them — it would
  double-release.

### Every park is a gate someone has to delete

Each GL-only path parks behind a `rendererGL !== null` test. **A port
child that lands its feature but leaves its gate in place ships a
feature that is silently dead on WebGPU** — tests pass, nothing warns,
the code simply never runs. So deleting the gate is part of the port,
in the same PR.

**Nothing is parked today.** What follows is the record of what closed
each row, so a new park adds its own row here rather than landing silently.

The line-layer row is gone: the local pass's three line layers (orbit
rings, binary orbit paths, probe trails) drew nowhere on this boot because
`LineBasicMaterial`'s lone fragment output fails WGSL pipeline creation
against the HDR target's three attachments — and one invalid pipeline
poisons the whole pass submit — so the shell removed their groups from the
pass scene. The chrome line seam (`../chrome-lines/README.md`) replaced
those materials and the three `remove()` calls went with it.

The HDR row is gone: the chain port deleted `HdrPipeline`'s null-renderer
park and `measureAdaptationStatistic`'s early return when `hdr/` landed.
The extinction-prepass row went with `0it.20`: `attachDust` now builds
one on either backend through `ExtinctionPrepassSeam`, so the
`rendererGL !== null` test is gone. `extinctionPrepass` is still
optional-chained, but on its lifecycle alone — it is null before the
first `attachDust` and after `attachDust(null)`, on both boots.
The three local-depth rows went with `0it.12`/`0it.4.8`: the pass renders
on both boots, the `localPassLive` flag is deleted from both clusters,
and the TSL star mirror + glare mirror repaint what collapses.

At cutover (`0it.13`) `rendererGL` is null forever and every surviving
gate becomes a permanently-false branch, so the WebGL2 deletion
(`0it.14`) sweeps whatever is left. That sweep is the backstop, not the
plan — a gate still standing then means its feature was dead for a
release.

**A park that REMOVES rather than skips is invisible to that backstop,
and the line-layer row was one.** It keyed on `webgpu !== null` — a
positive test — so at cutover the branch would have become permanently
TRUE, reading as ordinary unconditional code while a sweep for dead
false-branches walked straight past it. Any future park of that shape has
to be deleted by name; nothing else will catch it.

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
to the canvas and the shaders' encoded values land untouched — the
WebGL2 semantics.

The cost lands on three's **built-in materials**, which relied on that
output transform for their encode: one would render linear-dark on
anything reaching the canvas. Nothing does — every line overlay is on
the chrome line seam, whose single-output graph owns the encode and
selects it on the `uHdrTarget` node mirror, 0 exactly in chart mode
(`chrome-lines/README.md` § The encode the built-in path lost). Do not
"fix" a dark built-in by unpinning the output space — that re-breaks
every ported emitter and re-prices the hidden pass; put the material on
the seam instead.

**The clear colour is the second casualty, and no shader can fix that one.**
Chart mode's paper is a `setClearColor` hex, so nothing owns its transfer;
worse, this backend clears with the *working*-space components and never
reads `outputColorSpace` (`Background.update` → `_clearColor.getRGB()` at
its default space), where WebGL passes the canvas clear through
`getUnlitUniformColorSpace`. The paper is therefore authored in the space
the renderer clears in — `chart-mode/chart-palette.ts`'s
`paperClearColour`, which stays correct on both backends only because
output is pinned to working here. It shipped as a dirtier `#e9e2d2` paper
under `#renderer=webgpu` until 0it.6; a new clear colour owes the same
treatment.

Cross-copy caveat: `three/webgpu` is a second bundled copy of three's
core (§ Import boundary), so app objects built from `'three'` (camera,
vectors, textures) flow into the WebGPU renderer across copies. three
dispatches on `.isX` flags rather than instanceof, and the spike ran a
`'three'`-built LUT texture through both browsers — but treat any
"object not recognised" oddity as a cross-copy suspect first.

## Import boundary — nothing WebGPU in the WebGL2 bundle

`three/webgpu` (and `three/tsl`, which re-exports its node system) is a
separate ~1 MB entry that duplicates three's core, and no tree-shaking
removes an eagerly-imported renderer. The rule:

- **Value imports of `three/webgpu` / `three/tsl` live only in this
  folder**, in modules reachable solely through `main.ts`'s
  `import('./webgpu/boot-webgpu')` (Vite code-splits that whole graph
  into an async chunk the WebGL2 boot never fetches).
- Modules outside this folder may import from it **statically only for
  `renderer-flag.ts` and type-only imports** (`import type` is erased at
  compile time and costs nothing).
- A port child's TSL layer module is therefore also loaded dynamically
  — construct it through the seam, never `import` it from `stellata.ts`.

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
around (§ TSL typing shim), the 8-vertex-buffer limit and the
static/dynamic cadence split (§ Attribute packing), and the three legs a
ported layer is covered by (§ TSL test pattern).

## Early-z — the star layer's depth-honest redesign

Any static `gl_FragDepth` write disables early-z for the whole draw (in
WGSL: pipeline) and no conservative-depth qualifier exists in either
language, so the defensive write the three star passes share
(`../star-pipeline/README.md` § Depth encoding) costs all three their
early-z, not just the halo branch needing it. Port contract, valid on any
renderer or encoding: one program per pass (compile-time define replacing
`uRenderMode`); glow carries no depth output (removal of the defensive
write is bit-exact); the core-mask member stamp moves to the vertex stage
(per-instance, so clip z pins to the near end of the active depth
convention); the disc pass writes no depth at all, because the core-mask
draw already stamped the same fragments at the same value several
renderOrders earlier (`star/README.md` § The disc draw writes no depth
carries the argument, what it gives up, and the fallbacks).

**The contract is satisfied by removing writes, never by adding draws.**
A port child that answers "one program per pass" with a second draw over
the same 380k instances has made the migration cost more per frame than
the renderer it replaces — which is the one outcome the port is not
allowed to have. Draw count per subsystem is part of parity, alongside
what the pixels look like.

## Timestamps

The renderer boots with `trackTimestamp: true`, and `animate()` resolves on
**every rendered frame the probe left timestamps live on** — not only while
the HUD is open, and gated on `timestampsAvailable` alone. The resolve is
what recycles the query pool: tracking allocates a query pair per render pass
regardless of whether anyone reads the result, so a resolve gated on the HUD
instead overruns the 2048-query pool after ~1024 frames and three logs
`Maximum number of queries exceeded`, then stops sampling until something
resolves. Why the probe's verdict is the one admissible gate, plus two
properties the seam carries, all in `debug/gpu-timing/README.md`.

**The flag is a request, and a grant is not
proof:** three ANDs it with `hasFeature('timestamp-query')` and clears it
where the adapter withholds the feature — but Safari 26 grants it and then
reports the query set's type as an unknown enum, which fails the render
pass descriptor, invalidates the command encoder and discards the entire
submit. Every layer stops drawing and WebKit logs nothing, since it does
not fire `onuncapturederror`. `timestamp-probe.ts` settles it at boot by
driving one throwaway timestamped pass inside a validation scope and
clearing `trackTimestamp` when refused, so `timestampsAvailable` is the
probe's answer, never `hasFeature`'s. **The probe must run before the
first frame:** three caches the render pass descriptor per render target
and never clears a `timestampWrites` it already attached, so a descriptor
built while the flag was true stays poisoned for the backend's lifetime.
**One resolve in flight:** a concurrent resolve returns the same promise and
the same number, so `resolveAndPublishGpuFrame` publishes once per
completion rather than once per frame the readback spanned. **And a grant is
not a working clock:** Chrome grants the feature and then resolves whole
frames as a large negative number, so the channel drops any duration that is
not finite and positive and degrades exactly as the withheld case does.

The resolved figure is the summed real duration of every render pass in
one frame, so it lands as `gpu.frame` — the same row the WebGL2 timer
query fills, and the perf HUD's headline reads `gpu` rather than `submit`
on either backend. Subscribers (the HUD, a `debug.priceFrame()` sweep)
come and go through `debug/gpu-timing/gpu-frame-samples.ts` while the
resolve itself is gated on nothing but the probe's verdict. Per-pass `gpu.*` rows have no WebGPU
counterpart on purpose: three keys per-pass timestamps by an internal
uid, and the pricing differential answers the same question without
pinning three's internals. Detail in `debug/gpu-timing/README.md`.
