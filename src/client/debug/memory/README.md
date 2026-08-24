# Memory-footprint inventory

`debug.memory()` — what the app is holding, GPU-side and heap-side, at
the current state. The perf HUD prices *time*; this prices *space*, which
is what decides whether a weaker device can run the scene at all.

## Files in this area

```
src/client/debug/memory/
  memory-inventory.ts             The scene walk, the renderer cross-check,
                                  the heap rows, and the console print.
  memory-inventory-pure.ts        Byte math: texel sizes per format/type,
    (+ test)                      mip-chain factor, geometry attribute sums,
                                  shared-buffer dedupe, unit formatting.
```

## Running it

```js
debug.memory()          // prints two tables + the cross-check, returns the object
```

No gate hold, no instrumentation swap, no dwell — it reads live state and
returns. Safe to call from any vantage, in any mode. It reports what is
resident **now**: dust chunks stream in, the cloud bricks arrive with the
cloud catalog, and planet textures load per body, so an inventory taken
during boot is a smaller app than the one taken a minute in.

## What the walk reaches — and what it cannot

The GPU table comes from walking `stellata.sceneGraph`, deduped by
`uuid`: every geometry (attribute arrays + index, interleaved buffers
counted once) and every texture reachable from a material — including the
ones that hang off `ShaderMaterial.uniforms`, which is how the dust
`Data3DTexture` and the cloud bricks are found.

A row's `basis` says how it was priced, and the distinction matters:

- `array` — the resource's own CPU-side buffer, exact. Every
  `DataTexture` the app builds and every geometry attribute lands here.
- `format` — dimensions × format × type, for an image-backed texture
  whose decoded bytes exist only on the GPU.
- `unknown` — neither was available (a compressed format, or one three
  grew since). **Bytes read 0 and the row is flagged; it is not free.**

**Render targets are not in the scene graph and the walk cannot see
them.** Neither can it see a pass scene it does not visit (the local
depth pass, the HDR fullscreen quad), program/uniform storage, or the
canvas backbuffer. That is what the cross-check line under the table is
for: `renderer.info.memory` counts what three has uploaded, and the
difference against the walk is the off-scene set. If that delta grows
without a target being added, something is holding textures the walk
should have reached.

## Pricing the off-scene targets by hand

Until the render targets declare themselves, price them from the drawing
buffer — `renderer.getDrawingBufferSize()`, which is CSS pixels × device
pixel ratio, **not** `window.innerWidth`. Each row's authority is the
module that creates it; re-read it rather than trusting the byte figures
here, which are a worked example at one size.

| Target | Size | Per texel | Authority |
| --- | --- | --- | --- |
| HDR MRT | drawing buffer | 8 (RGBA16F) + 4 (RG16F) + 8 (RGBA16F) + 4 (depth24) = **24 B** | `../../hdr/README.md` § Three attachments |
| Rod summation | half on each axis (¼ the texels) | 8 B (RGBA16F) | `../../hdr/summation/README.md` |
| Reduction chain | quartering levels from the statistic attachment | 8 B/level, 16 B at the 1-texel tail | `../../hdr/exposure/reduction/README.md` § The chain |
| Extinction A_V | `AV_TEX_WIDTH` × ⌈stars ÷ `AV_TEX_WIDTH`⌉ | 4 B (R32F) | `../../star-pipeline/extinction/README.md` |
| Extinction positions | same grid | 16 B (RGBA32F), plus the same again CPU-side | same |

Worked example — a 1920×1080 window at `devicePixelRatio` 2, so a
3840×2160 drawing buffer (8.29 Mpx), with the shipped 313k-star catalog:

- HDR MRT — 8.29 Mpx × 24 B ≈ **199 MiB**. The single largest allocation
  in the app, and the only one that scales with the window: the same page
  on a 1× 1280×720 display pays ≈ 21 MiB for it. Anything the perf
  program does about resolution moves this number quadratically.
- Rod summation — 2.07 Mpx × 8 B ≈ **16 MiB**.
- Reduction chain — the quartering sum converges to ⅓ of the source, so
  ≈ 8.29 Mpx × 8 B ÷ 3 ≈ **22 MiB**.
- Extinction A_V — 1024 × 306 texels × 4 B ≈ **1.2 MiB**; its position
  texture ≈ **4.8 MiB** GPU + the same array retained on the heap.

So the viewport-scaled targets alone are ~240 MiB at dpr 2 before a
single star, cloud brick, or dust chunk is counted. Take the walk's
totals as the *rest* of the picture, not the whole of it.

## The heap half

The second table sums the typed arrays the shell holds by public handle:
the catalog columns and `localPositions`, the epoch-advanced duplicate of
`catalog.positions` in the local frame. Views sharing one `ArrayBuffer`
are charged once, to the first name that reaches them, and the row says
so — a column view keeps the whole parsed buffer alive, so the buffer is
what the heap is holding.

`performance.memory` prints under it where the browser offers it (Chrome
only, quantised, and it reports the whole isolate rather than this app).
Everywhere else, and whenever the number needs to be trusted:

1. DevTools → Memory → **Heap snapshot**, taken from a settled state —
   catalog loaded, dust streamed in, camera still. Boot-time snapshots
   measure a different app.
2. Compare **retained size**, not shallow size, and sort by it.
3. Take a second snapshot after the transition you suspect (chart mode
   on and off, a warp, a focus change) and diff them. A steady delta
   across repetitions is a leak; a one-off delta is a cache filling.
4. The typed-array table above is the floor a snapshot must exceed — if a
   snapshot reports less than the catalog columns sum to, it did not
   capture the whole isolate.

## Re-running it after the WebGPU port

The point of an inventory is the *second* reading. The walk is
backend-agnostic — it reads the scene graph and three's own counters, so
it works unchanged on a `#renderer=webgpu` boot — but two things change
the comparison and both must be stated when quoting a before/after:

- A WebGPU boot draws its own scene (`../../webgpu/README.md`), so until
  a port child parents its layers there, the walk finds less because
  less is *drawn*, not because the port is thriftier.
- The off-scene delta is where the port's target changes will show up
  first, and the hand-priced table above is WebGL-shaped. Re-derive it
  against whatever the ported passes bind before comparing totals.
