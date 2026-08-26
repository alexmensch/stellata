# TSL authoring layer

The scaffolding every port child builds on: how app data reaches a TSL
shader graph (uniform nodes per frame, packed attributes per instance),
the typing patches you need to write one, and the test pattern a ported
layer is covered by.

## Files in this area

```
src/client/webgpu/tsl/
  shared-uniform-nodes.ts (+ test)  TSL uniform-node mirror of
                                    ../../frame/shared-uniforms.ts.
  tsl-shim.ts (+ test)              Typed patches over @types/three's TSL
                                    surface — verified gaps only.
  attribute-packing-pure.ts         Plan + interleave N per-instance
    (+ test)                        scalars into ceil(N/4) vec4 buffers.
  attribute-packing.ts (+ test)     Geometry attributes + per-scalar
                                    accessor node from a pack plan.
  uniform-slots.ts                  The IUniform face a ported layer
                                    writes, over a record of TSL nodes.
  literal-drift-pure.ts (+ test)    Which pinned constants a TSL source
                                    restates as a bare literal — the scan
                                    behind every TSL-side drift guard.
  jitter-tsl.ts                     Interleaved gradient noise over the
                                    fragment position, and the ±0.5-LSB
                                    output dither over that.
```

Which star attributes actually pack, and how they split by upload
cadence, is `../star-attribute-roster.ts` — it composes over
`planVec4Packing` but is star-specific, so it stays with the layer that
owns the roster.

## Shared uniform nodes

`buildSharedUniformNodes(shared)` mirrors the WebGL-side
shared-uniforms-by-reference map (`../../frame/shared-uniforms.ts`) as TSL
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
  diverge (`../extinction/README.md` § Two nodes, one owner). `uAvPrepassTex`
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

## Uniform slots — the face a ported layer writes

A layer that ports as a material swap keeps writing `uniforms`, never
`material.uniforms`, and `uniformSlotsOf(nodes)` is what makes that reach
this backend: a TSL `uniform()` node already carries `.value` exactly as
an `IUniform` does, so most slots pass straight through. The one that
cannot is a **uniform array** — it has no `.value`, so the helper puts an
`IUniform` face over `UniformArrayNode.array`, which the layer mutates in
place and the node re-packs every render.

It lives here rather than beside any one subsystem because three of them
now build slot records through it — the solar-system surfaces, the
boundary shells, the dust sprite. The per-subsystem `*-uniform-nodes.ts`
modules stay with their layers; only the face is shared.

## Assigning a varying from an explicit vertex stage

A layer that sets `material.vertexNode` and wants a varying computed
inside it writes `varying(float(0), 'vName')` and `.assign(...)`s over
it. That reads like a race — the varying carries its own node, and the
fragment stage's reference forces that node to run in the vertex stage
too — but it resolves correctly, and the reason is worth stating so the
next port child does not re-derive it: `NodeBuilder` generates the vertex
stage before the fragment one, the varying's node properties are keyed
stage-agnostically, and the property is filled the first time it
generates. So the vertex stage emits the seed assignment followed by the
real one, and the fragment stage reads the interpolated result rather
than re-emitting the seed after it.

Cost is one dead store in the vertex shader. Prefer wrapping the
expression itself — `varying(expr)`, as the probe glyph and the ring
annulus do — whenever the value does not depend on state computed inside
the `vertexNode` body.

## Interleaved gradient noise

`interleavedGradientNoiseTsl` is the ray-start offset that turns a
few-sample lattice into fine grain, and the ±0.5-LSB output dither that
stops a whisper-level gradient banding on 8-bit — one shape, two jobs. It
is **static per pixel and never reseeded per frame**: animated jitter
shimmers (`docs/science-molecular-clouds.md` § 9.1 rules 3–4).

Both jobs are exported, because writing the dither out as
`noise(coord).sub(0.5).div(255)` is what let three copies of it
accumulate: `lsbDitherTsl` is that composition, and the resolve pass reads
it through `../tonemap-tsl.ts` rather than keeping a private twin. Its two
constants — the 8-bit divisor and the `DITHER_SEED_OFFSET` a caller adds
when it jitters a ray start off the same noise — live with the rest of the
dither's numbers in `../../hdr/tonemap/tonemap-pure.ts`.

The solar-system atmosphere still carries its own `atmoJitterTsl` over an
identical pair of constants under **different names**, and the three
hand-written GLSL `ign()` copies are still three. Both remain because
retiring `ATMO_JITTER_*` trips that subsystem's drift test by name and the
GLSL side wants a registered ShaderChunk — `0it.33`, which is now only
those two.

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

The literal half of leg 1 is `literal-drift-pure.ts`, shared by the
per-subsystem drift guards. It compares by **value, not by text**: shader
code spells an integral constant `30.0`, and a text pattern for `30`
rejects it on the trailing dot — which is the form a transcription
actually drifts into, so a text scan passes on precisely the case it
exists to catch. A number that merely coincides with a pinned value is
excused per-source with a written reason.

Node-graph introspection (walking the built node tree and asserting
structure) was considered and rejected: it pins three's internal node
representation, so every three bump breaks every shader test while
verifying no actual math.
