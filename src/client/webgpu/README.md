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

The test pins key parity against `buildSharedUniforms`, so adding a
WebGL slot without its node counterpart fails CI. Port-child materials
take slots from `stellata.webgpu.uniformNodes` — shared node objects are
what replaces shared uniform objects.
