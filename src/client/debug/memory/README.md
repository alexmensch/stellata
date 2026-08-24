# Memory-footprint inventory

`debug.memory()` — what the app is holding, GPU-side and heap-side, at
the current state. The perf HUD prices *time*; this prices *space*, which
is what decides whether a weaker device can run the scene at all.

## Files in this area

```
src/client/debug/memory/
  memory-inventory.ts             The scene walk, the row labels, the
                                  renderer cross-check, the heap rows,
                                  and the console print.
  memory-inventory-pure.ts        Row shapes and the math over them:
    (+ test)                      per-texture and per-geometry bytes,
                                  shared-buffer dedupe, duplicate-row
                                  folding, the cross-check, formatting.
```

Bytes per texel and the mip-chain factor come from
`../../util/texture-bytes-pure.ts`, shared with the planet-map VRAM
budget so a row here and the eviction decision over the same map cannot
disagree.

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

The GPU table walks every scene in `stellata.sceneGraphs`, deduped by
`uuid` across the set: every geometry (attribute arrays + index,
interleaved buffers counted once) and every texture reachable from a
material — including the ones hanging off `ShaderMaterial.uniforms`,
which is how the dust `Data3DTexture`, the cloud bricks and the
extinction A_V target are found **on a WebGL2 boot**. A TSL material
holds no `uniforms` slot, so none of that reaches a ported layer — § Re-running
it after the WebGPU port.

A row's `basis` says how it was priced:

- `array` — the resource's own CPU-side buffer, exact. Every
  `DataTexture` the app builds and every geometry attribute lands here.
- `format` — dimensions × format × type, for an image-backed texture or a
  render-target attachment, whose bytes exist only on the GPU.
- `unknown` — neither was available (a compressed format, or one three
  grew since). **Bytes read 0 and the row is flagged; it is not free.**

Identical resources are folded into one row with a `copies` count. The
default view parents several hundred identically-shaped boundary loops
and orbit lines, and one row each buries the handful holding real memory.

### Read the cross-check in both directions

`renderer.info.memory` counts what three has uploaded, and the print
reports **both** differences against the walk, because they mean
opposite things:

- **Uploaded but outside the walk.** Render targets nothing samples, and
  the pass scenes the walk does not visit — the extinction prepass
  (`../../star-pipeline/extinction/extinction-prepass.ts` holds its own
  `THREE.Scene`; its WebGPU twin holds no scene at all, drawing through a
  `QuadMesh`, so it is outside the walk for a second reason), the HDR
  tone-map quad, the summation and reduction passes. Also program/uniform storage and the canvas backbuffer, which
  no three counter exposes at all. If this grows without a target being
  added, something is holding textures the walk should have reached.
- **Walked but never uploaded.** Three counts a geometry when the draw
  path first asks for its buffers, so a scene-graph resource missing from
  that count has no GPU allocation: the walk is charging bytes the device
  is not holding. Over-counting is the safe direction — off-screen is not
  free — but it means the total is "CPU arrays held by parented objects",
  not strictly residency. The default Sol view walks ~550 geometries
  against 88 uploaded, so this is the larger of the two deltas by far.

**A render target is only reachable when something samples it.** The A_V
target lands in the table because the star pipeline reads it through a
uniform; the HDR MRT's statistic attachment and its depth buffer are
sampled by nothing and appear in neither table. Don't read the walk's
total as the whole picture — § below prices the rest by hand, and
`stellata-8cg.42` replaces that with a declaration on the seams once the
WebGPU ports land.

## Pricing the off-scene targets by hand

Price them from the drawing buffer — `renderer.getDrawingBufferSize()`,
which is CSS pixels × device pixel ratio, **not** `window.innerWidth`.
Each row's authority is the module that creates it; re-read it rather
than trusting the byte figures here, which are a worked example at one
size.

| Target | Size | Per texel | Authority |
| --- | --- | --- | --- |
| HDR MRT | drawing buffer | 8 (RGBA16F) + 4 (RG16F) + 8 (RGBA16F) + 4 (depth24) = **24 B** | `../../hdr/README.md` § Three attachments |
| Rod summation | half on each axis (¼ the texels) | 8 B (RGBA16F) | `../../hdr/summation/README.md` |
| Reduction chain | quartering levels from the statistic attachment | 8 B/level, 16 B at the 1-texel tail | `../../hdr/exposure/reduction/README.md` § The chain |
| Extinction positions | `AV_TEX_WIDTH` × ⌈stars ÷ `AV_TEX_WIDTH`⌉ | 16 B (RGBA32F), plus the same array retained on the heap | `../../star-pipeline/extinction/README.md` |

The A_V target itself is **measured** on a WebGL2 boot, not hand-priced —
the star pipeline samples it through a uniform, so it is in the GPU
table. **On a WebGPU boot it is neither**: the TSL vertex stage binds it
through a node, so the walk cannot reach it and it joins this table
instead, alongside the position texture.
`../../webgpu/extinction/README.md` § What it costs, and what it holds
carries both rows with their arithmetic for exactly that reason.

Worked example — a 1920×1080 window at `devicePixelRatio` 2, so a
3840×2160 drawing buffer (8.29 Mpx):

- HDR MRT — 8.29 Mpx × 24 B ≈ **199 MiB**. The single largest allocation
  in the app, and the only one that scales with the window: the same page
  on a 1× 1280×720 display pays ≈ 21 MiB for it. Anything the perf
  program does about resolution moves this number quadratically.
- Rod summation — 2.07 Mpx × 8 B ≈ **16 MiB**.
- Reduction chain — the quartering sum converges to ⅓ of the source, so
  ≈ 8.29 Mpx × 8 B ÷ 3 ≈ **22 MiB**.
- Extinction positions — 1024 × 322 texels × 16 B ≈ **5.0 MiB** GPU, and
  the same array again on the heap.

So the viewport-scaled targets alone are ~240 MiB at dpr 2 before a
single star, cloud brick or dust chunk is counted.

## The first reading — default Sol view, dust settled

Recorded so a later run has something to differ against. Absolute bytes
are reproducible here in a way frame timings are not, but the catalog
size and what has streamed in both move them, so both are stated.
329,657 catalogue records.

| | |
| --- | --- |
| GPU walk total | **169 MiB** over 549 geometries and 66 textures |
| dust `Data3DTexture` | **128 MiB** — 512³ at 1 B/texel, 76% of the walk |
| star instanced geometry | **21.4 MiB** — 15 attributes + index |
| extinction A_V target | **1.26 MiB** — 1024×322, 4 B/texel, `format` basis |
| cloud bricks | ~60 `Data3DTexture`s, 10 KiB–350 KiB each |
| heap, typed arrays | **39 MiB** |
| off-scene textures | 17 |
| walked but never uploaded | 461 geometries |

Two readings worth keeping in mind when quoting the totals:

- **The dust grid is three quarters of everything the walk finds.**
  Every other decision in the table is noise beside `attachDust(null)`.
- **461 of 549 walked geometries were never drawn.** Mostly the
  boundary loops and orbit rings the folding collapses. Their bytes are
  real CPU-side; they are not GPU residency.

## The heap half

The second table sums the typed arrays the shell holds by public handle:
the catalog columns and `localPositions`, the epoch-advanced duplicate of
`catalog.positions` in the local frame.

**The two tables overlap, deliberately.** `iPosition` is `localPositions`
itself and `iAbsmag` / `iCi` / `iSpectClass` / `iPeriodDays` /
`iAmplitudeMag` are the catalog columns by reference
(`../../star-pipeline/star-pipeline.ts`) — about 10.5 MiB appearing in
both. Nothing disposes the CPU array after upload, so both copies are
genuinely resident and the totals are each correct; it is not a
double-count, and summing them is right.

Views sharing one `ArrayBuffer` are charged once, in full, to the first
name that reaches them, and the row says so — a column view keeps the
whole parsed buffer alive, so the buffer is what the heap holds. No
catalog column takes that path today (each is its own allocation), so if
you see it fire, note that **which** name carries the charge is
`Object.entries` order, i.e. arbitrary; only the total is meaningful.

Fields that are not typed arrays get named under the table rather than
dropped — `catalog.names` is a `Map` of proper names, `constellations` an
array of records, and both hold heap no row can price.

`performance.memory` prints where the browser offers it (Chrome only,
quantised, and it reports the whole isolate rather than this app).
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

The point of an inventory is the *second* reading. The walk reads scene
graphs and three's own counters, so it runs on either backend — but three
things change the comparison and all three must be stated when quoting a
before/after:

- **A dual boot draws the seam's scene**, which is why `sceneGraphs` is
  plural and the walk visits every entry. Rows carry a `shell:` or
  `webgpu:` prefix once there is more than one scene, so a total can be
  split by backend.
- **A TSL material binds its textures through nodes, not through
  `uniforms`.** `eachTexture` finds a `THREE.Texture` on a material
  property or a uniform slot; a `NodeMaterial` holds neither, so the walk
  cannot price its textures. It does not pass over them silently: a node
  material the walk found no texture on gets an `unknown`-basis row
  naming it, so a ported layer shows up as flagged rather than absent.
  Pricing them means traversing the node graph, which is not done.
- **The hand-priced table above is WebGL-shaped.** Re-derive it against
  whatever the ported passes bind before comparing totals.
