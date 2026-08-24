# WebGPU dual-boot seam

The boot seam the WebGPU migration lands behind: the renderer flag, the
async `WebGPURenderer` boot, and the scaffolding every port child builds
on (shared uniform nodes, TSL typing shim, attribute packing, the TSL
test pattern). The shipped WebGL2 app is untouched while the flag is
off; nothing here reaches the WebGL2 bundle (§ Import boundary).

## Files in this area

```
src/client/webgpu/
  renderer-flag.ts (+ test)         Parse #renderer=webgpu|webgl2 from the
                                    URL fragment.
  seam.ts                           WebGpuSeam — the type-only contract the
                                    integration shell holds when the flag
                                    is on. StellataRenderer union type.
  boot-webgpu.ts                    Async boot: construct + init the
                                    WebGPURenderer, build the seam handle.
                                    The dynamic-import boundary.
  reversed-depth-sort.ts (+ test)   Render-list comparators countering
                                    r185's reversed-depth list reversal;
                                    retire with the three bump.
  shared-uniform-nodes.ts (+ test)  TSL uniform-node mirror of
                                    frame/shared-uniforms.ts.
  tsl-shim.ts (+ test)              Typed patches over @types/three's TSL
                                    surface — verified gaps only.
  attribute-packing-pure.ts         Plan + interleave N per-instance
    (+ test)                        scalars into ceil(N/4) vec4 buffers.
  attribute-packing.ts (+ test)     Geometry attributes + per-scalar
                                    accessor node from a pack plan.
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
console warning — the flag is a dev seam until the cutover; the
user-facing "requires WebGPU" gate page is a separate concern.

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
`../local-depth/bracket/README.md` § Decision). Its line layers (orbit
rings, binary orbit paths, probe trails) do NOT draw yet — see the park
table below.
The HDR chain runs for real through `hdr/` — MRT target, summation,
resolve, exposure reduction — behind the same `HdrSeam` interface the
WebGL pipeline implements (`../hdr/hdr-seam.ts`). The shell's WebGL
scene still exists and is never rendered on a WebGPU boot — no
per-layer gating, no material ever reaches the wrong backend.

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

### Every park is a gate someone has to delete

Each GL-only path parks behind a `rendererGL !== null` test. **A port
child that lands its feature but leaves its gate in place ships a
feature that is silently dead on WebGPU** — tests pass, nothing warns,
the code simply never runs. So deleting the gate is part of the port,
in the same PR:

| Parked path | Gate site | Deleted by |
| --- | --- | --- |
| Local-pass line layers (orbit rings, binary orbit paths, probe trails) | the shell removes their groups from the pass scene — `LineBasicMaterial`'s lone fragment output fails WGSL pipeline creation against the HDR target's three attachments, and one invalid pipeline poisons the whole pass submit | TSL line material (`0it.27`) |

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

**The line-layer row is gated the other way round, and the backstop
does NOT reach it.** It parks on `webgpu !== null` (a positive test in
`stellata.ts`'s constructor) rather than `rendererGL !== null`, because
what it does is *remove* groups rather than skip construction. At
cutover that branch becomes permanently TRUE, so it reads as ordinary
unconditional code and a sweep for dead false-branches walks straight
past it. `0it.27` must delete those three `remove()` calls by name;
nothing else will catch them.

The renderer boots with `reversedDepthBuffer: true` from day 1 — native
[0, 1] reversed clip, depth funcs remapped, clear inverted, all
upstream in three r185 — and `trackTimestamp: true` for the `gpu.frame`
perf row (§ Timestamps). `Depth32Float` is picked automatically for the
CANVAS only; a render target needs an explicit `FloatType` depth
texture (`../local-depth/bracket/README.md` § Precision analysis).

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
output transform for their encode: they render linear-dark until their
port child restores the encode on their own path (`Line2` / chrome
parity). Do not "fix" a dark built-in by unpinning the output space —
that re-breaks every ported emitter and re-prices the hidden pass.

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

## Shared uniform nodes

`buildSharedUniformNodes(shared)` mirrors the WebGL-side
shared-uniforms-by-reference map (`frame/shared-uniforms.ts`) as TSL
`uniform()` nodes, so every existing writer — `FilterController`,
`ExposureController`, `FloatingOrigin`, `animate()` — keeps writing the
WebGL map and never learns about the port. The contract:

- **Vector slots** (`uCameraPos`, `uViewport`, `uWorldOffset`) hold the
  WebGL map's value **objects by reference** — a `.set()` on the map
  reaches the node with no copy.
- **Scalar slots** (float, int, uint — the hdr emitter slots included)
  are **copied by `registry.sync()`**, called once per rendered frame
  from `animate()` before the render.
- **`uLocalMemberIdx`** (Int32Array(8)) splits into two `ivec4` nodes
  (`uLocalMemberIdx0/1`) — WGSL uniform arrays pad to a 16-byte stride.
- **Texture slots** (`TEXTURE_SLOTS`) are not mirrored: textures bind as
  per-layer `texture()`/`texture3D()` nodes where the texture lives. A
  uniform node cannot carry a **nullable** texture, so a slot the shell
  fills later (`uDustTexture`, `uAvPrepassTex`) binds over a placeholder
  whose `.value` is swapped on attach — one node per slot for the whole
  boot, since two consumers of the same volume must not be able to
  diverge (`extinction/README.md` § Two nodes, one owner). `uAvPrepassTex`
  in the shared map therefore stays null for a WebGPU boot's whole life.

The mirror is a **transcription, not a loop** — `uniform()`'s node type
comes from its overloads resolving against a concrete value, so a derived
version would need `UniformNode` (exported by neither `three/webgpu` nor
`three/tsl`) plus a value-kind ladder: a second deep import into three's
internals to save a transcription CI already guards. Within it, only the
vector lines are load-bearing; a mis-transcribed scalar is overwritten by
the first `sync()`.

Three legs pin it: key parity against `buildSharedUniforms` (adding a
WebGL slot without its node counterpart fails CI), every vector slot
holding its map object by identity, and a unique value per scalar proving
`sync()`'s reflective key filter reaches all of them. Port-child materials
take slots from `stellata.webgpu.uniformNodes` — shared node objects are
what replaces shared uniform objects.

## TSL typing shim

`tsl-shim.ts` carries ONLY compile-verified gaps in @types/three's TSL
typings, each deletable when upstream catches up. As of 0.185.4 the eaul
spike's worst findings are already fixed upstream (`pow`/`mix` take
vectors, getter swizzles are typed); what survives:

- `attribute(name, 'vec4')` infers its generic as `string`, losing every
  swizzle and operator — use `attrFloat/attrVec2/attrVec3/attrVec4`.
- `step` is float-pinned while the runtime is vec-capable — import
  `step` from the shim instead.
- `mix`'s vector overloads pin `t` to a float while the runtime (and
  WGSL `mix`) takes a vector `t` — import `mix` from the shim where the
  interpolant is per-channel (the sRGB encode's branch select).
- `ShaderNodeObject` is exported from neither `three/tsl` nor
  `three/webgpu`; the shim re-exports the typing's `NodeObject` under
  the runtime's name.

Before adding an entry, compile-probe the gap against the installed
@types — a cast that upstream already fixed is a shim that never dies.

## Attribute packing

WebGPU's default `maxVertexBuffers` is 8 and three binds one GPU vertex
buffer per `BufferAttribute`, so the star pipeline's **15** attributes
cannot port as-is. What those 15 are, and why the split matters:

- `aCorner` (vec2), `iPosition` (vec3) and `iPuls` (vec2) are **not
  packable** — the planner slots one component per name, so a
  multi-component attribute stays as it is. Three buffers.
- **9 static scalars** — `iAbsmag`, `iCi`, `iSpectClass`, `iLogRadius`,
  `iPeriodDays`, `iAmplitudeMag`, `iLumClass`, `iDistSol`, `iTeffApsis`
  — written once at catalog load. Three packed buffers.
- **3 `DynamicDrawUsage` scalars** — `iCompositeSuppress`,
  `iEclipseDim`, `iSuppressPulsation` — rewritten per frame by the
  binary / eclipse fields. **Pack these separately.** A vec4 uploads as
  one buffer, so mixing a per-frame scalar in with static neighbours
  turns each dim update into a 4×-wide re-upload of data that never
  changes. One packed buffer.

That is 7 of the 8 buffers — the limit is the binding constraint the
port lives under, not a comfortable margin, which is why storage buffers
indexed by `instance_index` supersede packing once the compute prepass
lands. Packing is the port-time answer, not the endgame.

`planVec4Packing(names, prefix)` assigns each name a (buffer, component)
slot in declaration order and **fixes the attribute-name prefix on the
plan** — the two cadence groups are two plans (`iPack<N>` / `iDyn<N>`),
and a prefix passed at build time but forgotten at access time would
read an attribute nothing ever set, silently. `buildPackedAttributes`
interleaves the source arrays into the plan's vec4 attributes;
`packedScalar(plan, name)` is the accessor node replacing
`attribute('iScalarName')`, over `packedAccess`'s pure (buffer name,
swizzle) resolution.

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
the same 313k instances has made the migration cost more per frame than
the renderer it replaces — which is the one outcome the port is not
allowed to have. Draw count per subsystem is part of parity, alongside
what the pixels look like.

## TSL test pattern — what a port child writes

The WebGL2 build's shader tests are text scans over `.glsl` sources.
Those keep guarding the live GLSL until the WebGL2 path is deleted; a
ported layer's TSL variant is covered by three legs, none of which read
generated code:

1. **Constants can't drift, by construction.** TSL is TypeScript: a
   shader constant is imported from the same module the test imports.
   The GLSL-era constant-drift guards (regex-pinning TS mirrors against
   shader text) have no TSL successor because the mirror IS the shader's
   own import — when a port child retires a `.glsl` file at cutover, its
   drift guard retires with it, replaced by direct `toBe(CONSTANT)`
   pins on the shared module.
2. **Policy/roster guards scan TS the way they scanned GLSL.** The
   frag-depth class of invariant ("no pipeline outside the allowlist
   writes depth") becomes a `walkFiles` scan over `src/**/*.ts` for the
   TSL equivalents (`depthNode` / `fragDepth` writes), same shape as
   `tests/shader-frag-depth.test.ts`. The family so far:
   `tests/webgpu-import-boundary.test.ts`, `tests/tsl-frag-depth.test.ts`
   and `tests/tsl-loop-control.test.ts` — the last pins an authoring trap
   rather than a policy: a concise arrow returns its expression, so
   `() => Break()` hands the jump back as the branch's output and the
   generator emits it twice, which the browser reports as unreachable
   WGSL on every boot. Brace the body, or express the exit as an `If()`
   around the body and emit no jump at all.
3. **Behavioural math lives in pure helpers; renders are A/B smoke.**
   The canonical scalar form of any shader rule belongs in a `*-pure.ts`
   TS function (most already exist as CPU mirrors — tonemap-pure,
   emission-pure, star-physics) with its unit tests; the TSL graph stays
   thin composition over the same constants. What a node graph *renders*
   is verified by the port child's parity smoke (same `?v=` state, flip
   the renderer), not by unit tests — executing shaders in vitest
   remains the hhaw WebGL2-test-seam epic's territory, and no port
   gates on it.

Node-graph introspection (walking the built node tree and asserting
structure) was considered and rejected: it pins three's internal node
representation, so every three bump breaks every shader test while
verifying no actual math.

## Timestamps

The renderer boots with `trackTimestamp: true`, and `animate()` resolves on
**every rendered frame** — not only while the HUD is open. The resolve is
what recycles the query pool: tracking allocates a query pair per render
pass regardless of whether anyone reads the result, so a gated resolve
overruns the 2048-query pool after ~1024 frames and three logs
`Maximum number of queries exceeded`, then stops sampling until something
resolves.

Two properties the seam carries for it, both in
`debug/gpu-timing/README.md`. **The flag is a request:** three ANDs it with
`hasFeature('timestamp-query')` and clears it silently where the adapter
withholds the feature, so the boot records the granted answer as
`timestampsAvailable` and consumers degrade off that instead of assuming.
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
resolve itself stays unconditional. Per-pass `gpu.*` rows have no WebGPU
counterpart on purpose: three keys per-pass timestamps by an internal
uid, and the pricing differential answers the same question without
pinning three's internals. Detail in `debug/gpu-timing/README.md`.
