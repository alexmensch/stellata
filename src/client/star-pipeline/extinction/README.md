# Per-star dust extinction

The camera→star V-band extinction read: one raymarch per star through
the Edenhofer 3D dust texture, cached in a star-indexed render target
that `../star.vert.glsl` consumes with a single `texelFetch`.

The **cancellation invariant** below is the load-bearing content here —
catalog `absmag` / `ci` are stored de-extincted, so this runtime stack
restores extinction rather than adding it twice.

**This march has no analytic slab term** — it integrates the measured
grid alone, and a sample outside the cube clamps to the zero-padded edge
rather than handing over to a slab. So extinction beyond the 1.25 kpc
coverage adds ≈0, which is what `scripts/catalog/distance/README.md`
§ Build-time de-extinction states from the build side and what the
cancellation invariant below requires: the runtime addition can only
cancel the terms the build subtraction actually used. The Milky Way
band's own dust column (`docs/science-galactic-structure.md` § The dust
stack) *does* carry the slab, and shares the ordering — but not the
sampling mechanism, and this march cannot take a prefiltered field
without breaking the cancellation.

## Files in this area

```
src/client/star-pipeline/extinction/
  extinction-seam.ts              ExtinctionPrepassSeam — the contract the
                                  integration shell holds, implemented once
                                  per backend, plus the shared uniform
                                  value-objects both write.
  extinction-prepass.ts           ExtinctionPrepass — the WebGL2 per-star A_V
                                  cache and its camera-displacement
                                  invalidation. TSL twin:
                                  ../../webgpu/extinction/.
  extinction-prepass.frag.glsl    The prepass draw: one fragment per star,
                                  writing raw physical A_V into R32F. Rides
                                  the shared fullscreen vertex stage +
                                  geometry in ../../util/fullscreen-pass.
  extinction-prepass-pure.ts      Texture geometry, position packing, and the
    (+ test)                      ε-displacement predicate. Vitest-pinned.
  dust-raymarch.glsl              Shared camera→star Edenhofer raymarch chunk
                                  (stellata_dust_raymarch), included by the
                                  prepass and by ../star.vert.glsl's fallback
                                  path. Spliced in stellata.ts via ?raw.
  dust-raymarch-pure.ts (+ test)  CPU mirror of the raymarch decode +
                                  trapezoidal integration and the
                                  E(B−V) = A_V / R_V reddening. Test-only;
                                  pins the shader math against
                                  synthetic-cloud fixtures.
```

## What the read produces

Each star is dimmed by the V-band extinction A_V integrated through
the Edenhofer 3D dust texture along the camera→star sightline, and
reddened by E(B−V) = A_V/3.1 on the intrinsic LUT-input B–V. That input
is the shader's two-tier routing: `Ballesteros(iTeffApsis)` when an
Apsis Teff is present, else the baked intrinsic `iCi` (observed AT-HYG
B–V or the spectral-class colour baked at build — see `../README.md`
§ Colour routing). Looking through dust dims and reddens stars behind
it, which is what you'd actually see.

## The prepass cache

`ExtinctionPrepass` renders one raymarch per *star* into a
star-indexed R32F render target (1024 × ⌈count/1024⌉; star *i* at
texel `(i % 1024, i / 1024)`); `../star.vert.glsl` consumes it with a
single `texelFetch`. Without the cache the identical integral ran in
the vertex shader once per vertex (×4) per pass (×2–3) — 8–12
recomputations per visible star per frame.

- **Invalidation** is camera-displacement-based: the target is
  recomputed when the absolute camera position moves more than
  `RECOMPUTE_EPSILON_PC` (1 pc) from the last-computed position, when
  a dust voxel chunk lands on the GPU (progressive load), or on
  (re-)attach. Between recomputes the cached values are served
  **stale-while-moving** — extinction varies on ~5 pc voxel scales,
  so worst-case drift at ε is ~0.003 mag. Close-range orbiting
  (AU-scale motion) never recomputes; a fast warp recomputes per
  frame, which still costs ~1/10th of the old per-vertex-per-pass
  scheme.
- **Positions are the catalog baseline** (`catalog.positions`, packed
  once into an RGBA float texture) — binary-orbit perturbations
  (sub-AU) are ignored, as is the floating origin (both the prepass
  march and the fallback run in absolute heliocentric space).
- **Fallback:** on WebGL2 contexts without `EXT_color_buffer_float` (no
  float-renderable target) the prepass is inert and the vertex shader
  runs the in-vertex camera→star raymarch, gated by the visibility
  prefilter. Both paths share the `stellata_dust_raymarch` chunk
  (`dust-raymarch.glsl`). That gate has no WebGPU counterpart — float
  render targets are core there, so the port's `supported` is constant
  true and the fallback branch survives only as the A/B switch below.
  The march's 48 fixed samples are a pragmatic trapezoidal integration:
  at 1.25 kpc that's 26 pc per step ≈ 5 voxels of the texture's native
  ~5 pc resolution; more samples cost proportionally with marginal
  quality gain.
- **A/B switch:** `stellata.setExtinctionPrepassEnabled(false)` (dev
  console) parks the shader on the fallback path AND pauses cache
  maintenance, so the fallback side never pays fill cost — the honest
  way to measure the prepass win on identical scenes; `true` restores
  the cache (re-validating against camera displacement).

The prepass stores raw physical A_V; `uDustEnabled ×
uExtinctionStrength` scales it at the point of consumption, so
strength changes never invalidate the cache.

## Reading A_V back on the CPU

`readAvMag(idx)` returns one star's raw A_V out of the cache texel
`star.vert.glsl` fetches — **synchronously, on WebGL2 only**. WebGPU has
no synchronous readback, so its implementation answers a cold index null
and warms the memo in the background; the caveats below are unchanged
either way, and the divergence — including how long a cold answer stands,
which is a pointer event rather than a frame — is
`../../webgpu/extinction/README.md` § Cold reads.

The pick paths are the only caller: a star's extinction decides whether
the renderer puts a pixel on screen for it at all, and a pick gated on
the intrinsic magnitude selects stars the frame drew black
(`../../hdr/exposure/README.md` § What "visible" means to a pick path).

**Reading the texel is the point** — the alternative, a CPU march, needs
the ~128 MiB voxel grid that `../../loaders/dust-loader.ts` uploads and
drops, and would be a second implementation of the integral free to
drift from this one. `dust-raymarch-pure.ts` stays test-only for exactly
that reason.

Two constraints on any new caller:

- **Event rate only.** A cold read is a synchronous `readPixels`, so it
  stalls the pipeline — the thing the reduction's fence exists to avoid
  (`../../hdr/exposure/reduction/README.md` § Latency). Reads are
  **memoised per star** and the memo is cleared exactly where the target
  is rewritten (`update()`'s recompute) — that one line is the whole
  invalidation rule, because the target's contents are the only other
  input. It matters because hover picks ride `pointermove`, which
  outruns the frame rate on a fast pointer; without the memo a sweep
  across a dusty field pays a stall per candidate. The pick path also
  resolves candidates lazily in score order, so a cold pick normally
  costs one read. Never sweep it over the catalog.
- **Null means no cache, not no dust.** On the fallback path (no
  `EXT_color_buffer_float`) the shader still dims the star through its
  in-vertex march while this returns null, so a consumer that treats
  null as "no extinction" degrades to the pre-existing behaviour rather
  than to a wrong answer.

## The cancellation invariant

Catalog `absmag` and `ci` are stored **intrinsic** (de-extincted at
build against the same voxel grid — see
`scripts/catalog/distance/README.md` § Build-time de-extinction), so this
runtime extinction *restores* the observer-relative extinction rather
than double-applying it: at camera=Sol the build subtraction and this
addition cancel, so a dusty-sightline star renders at its AT-HYG
observed magnitude. **Invariant:** any change to this runtime stack
(map, slab) must ship with the mirrored build-side integral + catalog
rebuild, or the cancellation breaks.

`stellata.setExtinctionStrength(x)` (dev console) scales the re-added
A_V: default 1 = physical realism; **0 = a dust-free universe** (every
star at its intrinsic brightness/colour everywhere, since nothing is
re-added on top of the de-extincted catalog); >1 amplifies dust
visually.
