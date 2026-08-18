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

An **empty sky with the full app alive**: every CPU subsystem (catalog,
star frame, focus, picker, typeahead, URL state, overlays, HUD, render
gate) runs identically; the renderer draws the seam's own scene
(`WebGpuSeam.scene`), which starts empty and gains layers as port
children land. The shell's WebGL scene still exists and is never
rendered on a WebGPU boot — no per-layer gating, no material ever
reaches the wrong backend. GPU-side subsystems park on their existing
fallbacks: the HDR seam runs in its unsupported mode (direct-to-canvas,
`hdr/README.md` § Fallback), the reduction never fences, the local-depth
pass and the dust voxel upload are gated off until their port children.

### Every park is a gate someone has to delete

Each GL-only path parks behind a `rendererGL !== null` test (or, for the
HDR seam, a null renderer). **A port child that lands its feature but
leaves its gate in place ships a feature that is silently dead on
WebGPU** — tests pass, nothing warns, the code simply never runs. So
deleting the gate is part of the port, in the same PR:

| Parked path | Gate site | Deleted by |
| --- | --- | --- |
| Dust voxel upload | `main.ts` skips the load; `attachDust` warns and returns | dust voxel streaming port (`0it.19`) |
| Extinction prepass | `attachDust` skips construction; `markDirty` is optional-chained | prepass port (`0it.20`) |
| Local depth pass | `animate()` skips `localDepthPass.render` | local-depth on WebGPU (`0it.12`) |
| HDR target, summation, reduction | `HdrPipeline` built with a null renderer; `measureAdaptationStatistic` returns early | HDR chain port (`0it.10`) |
| GPU timer rotation, frame pricing | `perfGlContext` returns null; `runPriceFrame` returns `[]` | instrumentation port (`0it.21`) |

At cutover (`0it.13`) `rendererGL` is null forever and every surviving
gate becomes a permanently-false branch, so the WebGL2 deletion
(`0it.14`) sweeps whatever is left. That sweep is the backstop, not the
plan — a gate still standing then means its feature was dead for a
release.

The renderer boots with `reversedDepthBuffer: true` from day 1 — native
[0, 1] reversed clip, `Depth32Float` picked automatically, depth funcs
remapped, clear inverted, all upstream in three r185 — and
`trackTimestamp: true` for the `gpu.render` perf row.

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
  per-layer `texture()`/`texture3D()` nodes where the texture lives.

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
convention); the disc pass splits into a depth-writing core draw plus a
depthWrite-off halo draw (a far-pinned halo write only ever re-wrote 1.0
over 1.0, so buffer state is unchanged; a viewport-depth-range far pin is
the bit-exact fallback if the halo's now-physical test regresses smoke).

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
   `tests/shader-frag-depth.test.ts`. `tests/webgpu-import-boundary.test.ts`
   is the first of the family.
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

The renderer boots with `trackTimestamp: true`, and `animate()` calls
`resolveTimestampsAsync()` on **every rendered frame** — not only while
the HUD is open. The resolve is what recycles the query pool: tracking
allocates a query pair per render pass regardless of whether anyone
reads the result, so a gated resolve overruns the 2048-query pool after
~1024 frames and three logs `Maximum number of queries exceeded`, then
stops sampling until something resolves. The milliseconds reach the HUD
as the `gpu.render` row through `perf-hud.ts`'s `gpuSampleSink`, which
is null while the HUD is closed — the frame still resolves, the sample
is just dropped. The WebGL2 `gpu.*` rotation, `gpu.frame` headline, and
the frame-pricing harness stay WebGL2-only until the instrumentation
port child lands.
