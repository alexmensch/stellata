# TSL authoring layer

The scaffolding every layer's graph builds on: how app data reaches a TSL
shader graph (uniform nodes per frame, packed attributes per instance),
the typing patches you need to write one, and the test pattern a layer is
covered by.

## Files in this area

```
src/client/webgpu/tsl/
  shared-uniform-nodes.ts (+ test)  TSL uniform-node mirror of
                                    ../../frame/shared-uniforms.ts.
  tsl-shim.ts (+ test)              Typed patches over @types/three's TSL
                                    surface — verified gaps only.
  uniform-slots.ts                  The IUniform face a layer
                                    writes, over a record of TSL nodes.
  literal-drift-pure.ts (+ test)    Which pinned constants a TSL source
                                    restates as a bare literal — the scan
                                    behind every TSL-side drift guard.
  tsl-source-fixture.ts             Reads a shipped TSL module as text with
                                    its comments stripped, for the suites
                                    that pin expression shapes
                                    (README.md#tsl-test-pattern--what-a-layers-suite-covers).
  jitter-tsl.ts                     Interleaved gradient noise over the
                                    fragment position, and the ±0.5-LSB
                                    output dither over that.
  storage-attribute.ts (+ test)     Release of a storage buffer attribute
                                    no geometry owns, the write/read node
                                    pair over one buffer, and the
                                    vertex-stage device limit
                                    (README.md#storage-attributes).
```

Which per-star field feeds which storage table is
`../star-attribute-roster.ts` — star-specific, so it stays with the
layer that owns the roster ([Per-instance data](#per-instance-data)).

## Shared uniform nodes

`buildSharedUniformNodes(shared)` mirrors the shared-uniforms-by-reference
map (`../../frame/shared-uniforms.ts`) as TSL `uniform()` nodes, so every
writer — `FilterController`, `ExposureController`, `FloatingOrigin`,
`animate()` — writes the plain map and never learns about the nodes. The
contract:

- **Vector slots** (`uCameraPos`, `uViewport`, `uWorldOffset`) hold the
  map's value **objects by reference** — a `.set()` on the map
  reaches the node with no copy.
- **Scalar slots** (float, int, uint — the hdr emitter slots included)
  are **copied by `registry.sync()`**, called once per rendered frame
  from `animate()` before the render.
- **`uLocalMemberIdx`** (Int32Array(8)) splits into two `ivec4` nodes
  (`uLocalMemberIdx0/1`) — WGSL uniform arrays pad to a 16-byte stride.
- **Texture slots** (`FRAME_TEXTURE_SLOTS`) are not mirrored: textures bind as
  per-layer `texture()`/`texture3D()` nodes where the texture lives. A
  uniform node cannot carry a **nullable** texture, so a slot the shell
  fills later (`uDustTexture`) binds over a placeholder whose `.value` is
  swapped on attach — one node per slot for the whole boot, since two
  consumers of the same volume must not be able to diverge
  ([One owner for every shared slot](../extinction/README.md#one-owner-for-every-shared-slot)). The A_V cache is a
  storage buffer, bound the same way (§ Storage attributes).
  **A placeholder's filter pair is what its node's WGSL fetches with**, for
  the graph's whole life and whatever is swapped in later — so the
  placeholder carries the real texture's pair
  ([A stand-in's filters](../solar-system/README.md#a-stand-ins-filters)).

The mirror is a **transcription, not a loop** — `uniform()`'s node type
comes from its overloads resolving against a concrete value, so a derived
version would need `UniformNode` (exported by neither `three/webgpu` nor
`three/tsl`) plus a value-kind ladder: a second deep import into three's
internals to save a transcription CI already guards. Within it, only the
vector lines are load-bearing; a mis-transcribed scalar is overwritten by
the first `sync()`.

Three legs pin it: key parity against `buildSharedUniforms` (adding a
slot without its node counterpart fails CI), every vector slot
holding its map object by identity, and a unique value per scalar proving
`sync()`'s reflective key filter reaches all of them. Materials take
slots from `stellata.webgpu.uniformNodes`.

## Uniform slots — the face a layer writes

A layer that takes its material from a factory writes `uniforms`, never
`material.uniforms`, and `uniformSlotsOf(nodes)` is what makes that reach
the graph: a TSL `uniform()` node already carries `.value` exactly as
an `IUniform` does, so most slots pass straight through. The one that
cannot is a **uniform array** — it has no `.value`, so the helper puts an
`IUniform` face over `UniformArrayNode.array`, which the layer mutates in
place and the node re-packs every render.

It lives here rather than beside any one subsystem because four of them
now build slot records through it — the solar-system surfaces, the
boundary shells, the dust sprite, the Milky Way band. The per-subsystem
`*-uniform-nodes.ts` modules stay with their layers; only the face is
shared.

## Storage attributes

A buffer bound through `storage()` — a compute kernel's output, a table
the vertex stage indexes by instance — is a `StorageBufferAttribute` that
belongs to no geometry, and three r185 frees a GPU buffer only through
the geometry that owns its attribute. `BufferAttribute.dispose()`
dispatches an event nothing in three's WebGPU renderer listens to, so a storage
attribute released that way leaks its buffer for the renderer's life.
`disposeStorageAttribute(renderer, attribute)` walks the same private
registry `Geometries` uses to drop its own attributes; it is the one
reach into a renderer private in this folder, and a three bump has to
re-verify the field name. Whoever allocates the attribute owns that
call, in its dispose, in the same diff ([Lifecycle pairing](../../../../docs/authoring-patterns.md#lifecycle-pairing)).

Three properties of a storage node worth knowing before binding one:

- **Access is per stage, not per node — until something narrows it.** The
  WGSL builder declares a storage buffer `read` in any non-compute stage
  whatever the node's own access, and the bind-group layout types it
  read-only there — so ONE `StorageBufferNode` object can be the kernel's
  write target and a vertex stage's read source at once. Sharing it by
  identity is what makes a `.value` swap reach every consumer (the
  extinction A_V slot, [One owner for every shared slot](../extinction/README.md#one-owner-for-every-shared-slot)).
  **`toReadOnly()` is the exception, and it narrows in place.** It is
  `setAccess(READ_ONLY)` returning the same node, not a view, and an
  explicit access binds in the compute stage too — so narrowing a node a
  kernel assigns through makes that kernel's own pipeline fail to compile
  (`cannot store into a read-only type`), at boot, on the device, where
  neither vitest nor tsc can see it. A buffer one kernel writes and
  another only reads therefore needs **two `storage()` calls over the one
  attribute**. `storageWriteRead(build)` (`storage-attribute.ts`) is that
  pair — it calls `build` twice and narrows only the reader — and the
  refill dispatch takes it ([The refill dispatch](../star/compaction/README.md#the-refill-dispatch)).
  **Narrowing is safe only on a `storage()` call's own
  result**, which no other holder can reach;
  `../../../../tests/tsl-storage-narrowing.test.ts` scans `src/` for the
  rest, and the pair builder is its one exemption.
- **The WGSL array is runtime-sized.** `bufferCount` reaches the shader
  only for uniform buffers, so a node built over a 1-element placeholder
  and later pointed at the real attribute needs no rebuild — the binding
  layer rebinds when it sees a different attribute behind the node.
- **Reading one from a VERTEX stage is a device limit, not a core
  guarantee** — `maxStorageBuffersInVertexStage`, which WebGPU's
  compatibility feature level reports as **zero**. three requests that
  level unconditionally (`WebGPUBackend.init`) and works around several of
  its limits but not this one, so a device holding no vertex-stage storage
  buffer boots and then fails every pipeline that binds one. The dust A_V
  cache is the one that does, across all three star pipelines, and one
  invalid pipeline discards the whole submit ([One scene per boot](../README.md#one-scene-per-boot)).
  `supportsVertexStageStorageBuffers` is therefore a boot
  refusal in `../boot-webgpu.ts`, beside the `reversedDepthBuffer` one: the
  requires-WebGPU page, not a black canvas. A device reporting no limit at
  all predates the compatibility level, so core limits apply and it
  passes. The refusal holds the device to
  `STAR_VERTEX_STAGE_STORAGE_BUFFERS` (`../star/star-layer.ts`, 7): the
  survivor list, the A_V cache, the static table and the four forwarded
  tables a main-pass star vertex stage binds. Core guarantees 8 per
  stage. **Any new vertex-stage storage binding on the star pipelines
  raises that constant** — and the gate page is the ceiling on what this
  renderer can ask of a device ([Binding budget](../star/compaction/README.md#binding-budget)).

## One program per material instance

`NodeMaterial.customProgramCacheKey()` is the class name plus a hash of the
node graph, and that hash is **per instance**: two materials built by the
same factory from identical arguments produce different keys, so three's
node-builder-state cache misses and each one compiles its own WGSL and its
own pipeline. Found on the chrome line strokes, but it is a property of the
node system rather than of that layer.

The consequence a layer has to design around: **a material shared
across N objects**: a per-object material is N shader builds and N
pipelines, where a program cache would have collapsed N identical
materials onto one program and hidden the duplication. Hoist it to the
layer — the
orbit rings were 27 of them ([Orbit rings](../../solar-system/ephemerides/README.md#orbit-rings)).

It also rules cache-key equality out as a test: two graphs that ought to be
identical never compare equal. Pin the observable surface instead
(§ TSL test pattern, leg 2).

## Assigning a varying from an explicit vertex stage

A layer that sets `material.vertexNode` and wants a varying computed
inside it writes `varying(float(0), 'vName')` and `.assign(...)`s over
it. That reads like a race — the varying carries its own node, and the
fragment stage's reference forces that node to run in the vertex stage
too — but it resolves correctly, and the reason is worth stating so the
next layer does not re-derive it: `NodeBuilder` generates the vertex
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
shimmers ([§ 9.1](/docs/science-molecular-clouds.md#91-sampling-and-anti-aliasing--banding-is-the-known-failure-mode) rules 3–4).

Both jobs are exported, because writing the dither out as
`noise(coord).sub(0.5).div(255)` is what let three copies of it
accumulate: `lsbDitherTsl` is that composition, and the resolve pass reads
it through `../tonemap-tsl.ts` rather than keeping a private copy. Its two
constants — the 8-bit divisor and the `DITHER_SEED_OFFSET` a caller adds
when it jitters a ray start off the same noise — live with the rest of the
dither's numbers in `../../hdr/tonemap/tonemap-pure.ts`.

**One helper, one hash.** The planet mesh and the atmosphere shell call
`interleavedGradientNoiseTsl` like every other layer, and
`webgpu/solar-system/tsl-drift.test.ts` pins the helper's name while
forbidding its numbers as literals.

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
- `compute`'s count is number-pinned while the runtime takes an
  `IndirectStorageBufferAttribute` and dispatches at the workgroup count
  the GPU wrote into it — `computeIndirect`. A numeric count would also
  make three prepend an early return on it, which an indirect dispatch
  has no count to bound by.

Before adding an entry, compile-probe the gap against the installed
@types — a cast that upstream already fixed is a shim that never dies.

## Per-instance data

WebGPU's default `maxVertexBuffers` is 8 and three binds one GPU vertex
buffer per `BufferAttribute`, so a population with more per-instance
attributes than that cannot bind them as vertex attributes. Two layers
answer it two ways, and the split is about whether the instance index
still names the object:

- **The planet glare** (`../solar-system/planet-glare-geometry.ts`)
  interleaves its 13 per-instance scalars into vec4 vertex attributes.
  Its instance index IS the body, so a vertex attribute fetched by
  instance still addresses the right record.
- **The star layer** reads every per-star field out of storage tables
  indexed by star ([Star tables](../star/README.md#star-tables--every-per-star-field-is-a-storage-read)), because its draws
  are compacted: the instance index names a survivor-list slot, and a
  vertex attribute cannot be fetched at an arbitrary index. The tables
  bind under `maxStorageBuffersInVertexStage` instead ([Storage
  attributes](#storage-attributes)), one binding per table.

A vec4 interleave uploads whole, so a per-frame scalar interleaved with
static neighbours turns each of its updates into a 4×-wide re-upload of
data that never changes — the glare keeps its per-frame scalars in their
own buffer for that reason, and the star tables keep each live scalar in
its own table.

## TSL test pattern — what a layer's suite covers

A layer is covered by three legs, none of which read generated code:

1. **Constants can't drift, by construction.** TSL is TypeScript: a
   shader constant is imported from the same module the test imports, so
   the mirror IS the shader's own import and a direct `toBe(CONSTANT)`
   pin on the shared module is the whole guard.
2. **Policy/roster guards scan the TS source.** The
   frag-depth class of invariant ("no pipeline outside the allowlist
   writes depth") is a `walkFiles` scan over `src/**/*.ts` for
   `depthNode` / `fragDepth` writes. The family so far:
   `tests/webgpu-import-boundary.test.ts`, `tests/tsl-frag-depth.test.ts`,
   `tests/tsl-loop-control.test.ts` and
   `tests/tsl-standin-filters.test.ts` — the last two pin authoring traps
   rather than policies. A concise arrow returns its expression, so
   `() => Break()` hands the jump back as the branch's output and the
   generator emits it twice, which the browser reports as unreachable
   WGSL on every boot; brace the body, or express the exit as an `If()`
   around the body and emit no jump at all. And a data texture's
   nearest/nearest default bakes an unfiltered fetch into the WGSL
   ([Shared uniform nodes](#shared-uniform-nodes)), so every construction states its filter pair.
3. **Behavioural math lives in pure helpers; renders are smoke.**
   The canonical scalar form of any shader rule belongs in a `*-pure.ts`
   TS function (most already exist as CPU mirrors — tonemap-pure,
   emission-pure, star-physics) with its unit tests; the TSL graph stays
   thin composition over the same constants. What a node graph *renders*
   is verified in a browser, not by unit tests — vitest executes no
   shader.

**A graph's expression SHAPE is pinned as source text**, which is the
fourth leg where a claim has no scalar form: the shadow-span cut, the
`litFraction` bounds, which solid angle reaches which attachment. Read the
module through `tsl-source-fixture.ts` — it strips comments first, because
these modules quote their own expressions in prose and a `toContain` over
the raw text can be satisfied by the comment rather than by the graph.

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

A node's own **binding** properties are the exception, and `access` is the
one that has to be asserted: `access`, `value` and `isStorageBufferNode`
are typed public surface rather than graph shape, they survive a bump that
changes code generation, and a change in what `toReadOnly()` does to them
is precisely what must fail a test rather than a boot ([Storage
attributes](#storage-attributes)).
