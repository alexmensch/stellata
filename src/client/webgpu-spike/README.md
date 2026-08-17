# WebGPU star-pipeline spike (throwaway)

Standalone WebGPURenderer port of the star shader pair, twice — once in
TSL, once in raw WGSL (`wgslFn`) — on synthetic data. This folder is a
**spike on a throwaway branch**: it calibrates the migration and is not
shipped, imported by the app, or maintained. The findings and the
authoring recommendation it exists to produce live in the migration
epic's tracker notes; the durable port contract is
`../star-pipeline/README.md` § Early-z.

## Run

`pnpm run dev`, then open `http://localhost:5173/webgpu-spike/spike.html`
(`?impl=wgsl` starts on the raw-WGSL variant; `t` toggles live). Needs a
WebGPU browser — Chrome, Safari 26, or Firefox 141+ (macOS ARM ~145+).

## What it exercises

- **Reversed-z**, native: `WebGPURenderer({ reversedDepthBuffer: true })`
  gives a reversed projection + Depth32Float + remapped depth funcs
  upstream. Camera runs the app's real range (near 1e-12, far 1e5 pc);
  the scripted pair at 0.5 AU / 5.5 AU probes main-pass disc ordering
  that standard 24-bit depth quantised away.
- **Four depth-honest pipelines** per the port contract: core-mask
  (member stamp pinned to near in the *vertex* stage), disc-core,
  disc-halo (depthWrite off, real-depth tested), glow. No pipeline
  writes frag depth.
- **Per-channel `max` blend** (disc passes), additive (glow).
- **u32 spectral mask** (`&`, `<<` on a uint uniform), **instance_index**
  compares, **clip-space sentinel** early-outs, **ivec4 uniform**.
- **texture_3d** — the 48-step dust raymarch, sampled in the vertex
  stage (`textureSampleLevel`), plus the 2D blackbody LUT (the real
  generated table).
- **Timestamp queries** — `trackTimestamp: true` +
  `resolveTimestampsAsync`, on the HUD.
- **Packed instanced attributes** — WebGPU's default `maxVertexBuffers`
  is 8 and three binds one vertex buffer per `BufferAttribute`, so the
  app's 14 scalar instanced attributes are packed into four vec4 slots
  here.

## What it deliberately drops

Chart mode, eclipse dim / composite suppress / per-frame attribute
rewrites, the extinction prepass cache (`texelFetch` path — the spike
always marches in-vertex), the local-depth mirror, `uPinFocusToCenter`,
the HDR MRT target + statistic attachment (renders direct to canvas via
the inline undithered tone-map, the `uHdrTarget = 0` path), and the
8-slot member array (vec4i here).

## Files

- `star-common.ts` — shared uniform nodes, packed geometry, per-pass
  blend/depth state, pass constants.
- `star-tsl.ts` — TSL implementation (four materials via `Fn` graphs;
  pass specialization is a JS-level constant, so each material compiles
  its own branch-free program).
- `star-wgsl.ts` — raw-WGSL implementation (`wgslFn`); varyings leave
  the vertex function through pointer out-params because struct returns
  from `wgslFn` are unproven in r185. The address space must be
  `ptr<private>`, not `ptr<function>`: three hoists vertex-stage
  `.toVar()` vars to module scope (`var<private>`), so the generated
  call site passes private-space pointers — which also makes the
  variant depend on the `unrestricted_pointer_parameters` WGSL language
  feature (the HUD boot log prints `wgslLanguageFeatures`).
- `synthetic-stars.ts` — deterministic 50k-star field + scripted probes
  (Sol twin, 5 AU companion, supergiant, Mira) + encoded dust blob.
- `main.ts` / `spike.html` — boot, controls, HUD, toggle keys.
