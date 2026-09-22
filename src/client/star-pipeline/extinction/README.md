# Per-star dust extinction

The camera→star V-band extinction read: one raymarch per star through
the Edenhofer 3D dust texture, cached in a star-indexed render target
that the star vertex stage consumes with a single indexed read.

The **cancellation invariant** below is the load-bearing content here —
catalog `absmag` / `ci` are stored de-extincted, so this runtime stack
restores extinction rather than adding it twice.

**This march has no analytic slab term** — it integrates the measured
grid alone, and a sample outside the cube clamps to the zero-padded edge
rather than handing over to a slab. So extinction beyond the 1.25 kpc
coverage adds ≈0, which is what `scripts/catalog/distance/dust/README.md`
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
  extinction-prepass-pure.ts      Texture geometry, position packing (the
    (+ test)                      vec4 loop both backends fill from, in star
                                  order here and in the WebGPU twin's own
                                  dispatch order there), and the
                                  ε-displacement predicate. Vitest-pinned.
  av-parity-pure.ts (+ test)      Bit-level compare of two per-star A_V
                                  arrays + its console line — the WebGPU
                                  kernel's parity check reads through it
                                  (../../webgpu/extinction/README.md § The
                                  prepass kernel).
  dust-raymarch-pure.ts (+ test)  CPU mirror of the march — the segment–cube
                                  clip, the tap rule, the decode, the midpoint
                                  sum — and the E(B−V) = A_V / R_V reddening.
                                  The TSL march imports its constants; the
                                  build's integral imports its clip; the
                                  runtime never calls it.
```

## The march

`dustRaymarchAV(absFrom, absTo)` integrates A_V along the camera→star
segment in two steps, identical in the GLSL chunk, the TSL twin and the
CPU mirror:

1. **Clip to the cube.** A slab test per axis yields the segment's
   parametric overlap `[t0, t1]` with the ±`uDustBoundsPc` cube
   (`segmentCubeOverlap`); an empty overlap returns 0 before any fetch.
   Outside the cube the grid is zero-padded, so a tap there could only
   ever add ≈0 — clipping changes where the taps LAND, not what the
   integral means. From inside the dust nearly every tap already landed
   inside; from a far vantage the unclipped march spent almost all of
   them on empty space, and the clip is a ~2–9× tail-error win at
   identical cost (3 kpc out: p90 0.094 → 0.040 mag; 1 Mpc:
   0.347 → 0.038).
2. **Spend taps in proportion to the in-cube path.** One tap per
   `DUST_TAP_PC` of overlap, clamped to `[DUST_TAPS_MIN, DUST_TAPS_MAX]`
   (`dustMarchTapCount`), midpoints over the overlap, each `uvw` clamped
   to the volume exactly as the sampler's clamp-to-edge does. A fixed
   count spreads itself over path lengths that vary by an order of
   magnitude — 48 taps on a 30 pc neighbour and on a 1.2 kpc sightline —
   so at equal mean cost the adaptive rule carries less error.

**The tail is bounded by `DUST_TAPS_MAX`, not by the density.** A
sightline through a dense core is wrong at the cap whatever the density,
because the log decode makes cores far narrower than the encoded field.
Choose the rule on the p90/p99 of the sweep, and raise the cap rather
than the density when the tail is the complaint. The shipped pair —
10 pc per tap, cap 96 — reads 44 taps per star at Sol against the flat
48 it replaced: fewer taps AND less than half the tail (p99 0.130 →
0.066 mag, max 1.28 → 0.47), because the taps a nearby star no longer
wastes are what the cap lets a dusty distant one spend.

**Do not spend taps to buy frame time back.** The density is an accuracy
knob, chosen on the sweep's tail above; what it costs is known and
bounded. Measured 2026-09-19 at one commit over the five canon vantages
(`.perf-runs/2026-09-19/8cg595-refill-off.json` against
`-refill-on.json`), the kernel splits roughly in half: a per-THREAD
floor of ~0.6–0.8 ms at every vantage — the visibility gate's scattered
reads, the position read, the write, the dispatch — read directly at
`lg`, where the gate admits nothing and no tap is spent; and the march
itself, ~0.5–1.2 ms from inside the disc. No tap rule reaches the floor.
The march's half does move with density — 15 → 10 pc per tap read
+0.42 ms at `mw120` against `.perf-runs/2026-09-18/8cg584-recompute-all-cold.json`
— so a coarser rule buys frame time only out of that half, at the tail
error the sweep prices.

The instrument is `pnpm run analyse:march-taps`
(`scripts/dust/march-taps/README.md`): every scheme against the
converged in-cube integral the catalogue build uses, at four vantages.
Re-run it before moving any of the three constants; the numbers belong in
the PR and the bead, not here.

**Any change here ships with the mirrored build-side integral**
(§ The cancellation invariant). The build integrates the same clipped
overlap at a step of at most one voxel (`avAlongSegment`), so today the
only at-Sol residual is this march's quadrature.

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

The prepass computes one raymarch per *star* into a star-indexed
buffer the vertex stage reads by star index. Without the cache the
identical integral runs in the vertex stage once per vertex (×4) per
pass (×2–3) — 8–12 recomputations per visible star per frame.

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
  **On WebGPU a fourth trigger joins those three: the view turning.**
  The kernel refills only what the frustum holds, so a turn exposes stars
  no camera position ever asked for, and it requests a refill exactly as a
  displacement does — which is why AU-scale orbiting is free of a *march*
  there but not of a dispatch. Displacement alone still governs the
  values, since A_V depends on camera position only
  (`../../webgpu/extinction/refill/README.md` § A view change is a refill
  request).
- **Positions are the catalog baseline** (`catalog.positions`, packed
  into an RGBA float texture) — binary-orbit perturbations (sub-AU) are
  ignored, as is the floating origin (both the prepass march and the
  fallback run in absolute heliocentric space). The pack is a *copy*, and
  the model clock's space-motion pass rewrites that array in place, so
  `refreshPositions()` re-packs it from the epoch advance itself; without
  that the march follows the stars no further than the attach epoch.
- **Fallback:** the vertex stage can run the camera→star raymarch
  in-line instead, gated by the visibility prefilter, sharing the march
  with the prepass through `dust-raymarch-tsl.ts`. Nothing reaches it on
  capability — float render targets are core on this backend, so
  `supported` is constant true and the branch survives only as the A/B
  switch below. The march's tap count and clip are § The march.
- **A/B switch:** `stellata.setExtinctionPrepassEnabled(false)` (dev
  console) parks the shader on the fallback path AND pauses cache
  maintenance, so the fallback side never pays fill cost — the honest
  way to measure the prepass win on identical scenes; `true` restores
  the cache (re-validating against camera displacement).
- **Forced-recompute lever:** `stellata.setExtinctionRecomputeForced(true)`
  invalidates the cache before every `update()`, so the fill runs on every
  frame at a parked camera. It exists because the displacement gate makes
  the fill free at exactly the vantages a measurement can hold still at —
  `../../debug/frame-cost/passes/README.md` § The extinction rows. Dwell
  only; it re-arms the pick mirror's copy every frame in the live app.

The prepass stores raw physical A_V; `uDustEnabled ×
uExtinctionStrength` scales it at the point of consumption, so
strength changes never invalidate the cache.

## Reading A_V back on the CPU

`readAvMag(idx)` returns one star's raw A_V out of the cache texel
`../../webgpu/star/star-vertex-tsl.ts` fetches — **synchronously, on WebGL2 only**. WebGPU has
no synchronous readback, so its implementation answers out of a CPU
mirror of the whole buffer that the pointer events preceding a pick stage
for it (`warmAvReadback`), and null until one lands; the caveats below
are unchanged either way, and the divergence is
`../../webgpu/extinction/README.md` § Cold reads.

The pick paths are the only caller: a star's extinction decides whether
the renderer puts a pixel on screen for it at all, and a pick gated on
the intrinsic magnitude selects stars the frame drew black
(`../../hdr/exposure/visibility/README.md`
§ What "visible" means to a pick path).

**Reading the texel is the point** — the alternative, a CPU march, needs
the ~128 MiB voxel grid that `../../loaders/dust-loader.ts` uploads and
drops, and would be a second implementation of the integral free to
drift from this one. `dust-raymarch-pure.ts` stays test-only for exactly
that reason.

Two constraints on any new caller:

- **Event rate only — on this backend.** A cold read here is a
  synchronous `readPixels`, so it stalls the pipeline — the thing the
  reduction's fence exists to avoid
  (`../../hdr/exposure/reduction/README.md` § Latency). Reads are
  **memoised per star** and the memo is cleared exactly where the target
  is rewritten (`update()`'s recompute) — that one line is the whole
  invalidation rule, because the target's contents are the only other
  input. It matters because hover picks ride `pointermove`, which
  outruns the frame rate on a fast pointer; without the memo a sweep
  across a dusty field pays a stall per candidate. The pick path also
  resolves candidates lazily in score order, so a cold pick normally
  costs one read. Never sweep it over the catalog — the WebGPU twin does
  sweep, in one asynchronous copy that stalls nothing, which is the
  difference the two backends' contracts turn on.
- **Null means no cache, not no dust.** On the fallback path (no
  `EXT_color_buffer_float`) the shader still dims the star through its
  in-vertex march while this returns null, so a consumer that treats
  null as "no extinction" degrades to the pre-existing behaviour rather
  than to a wrong answer.

## The cancellation invariant

Catalog `absmag` and `ci` are stored **intrinsic** (de-extincted at
build against the same voxel grid — see
`scripts/catalog/distance/dust/README.md` § Build-time de-extinction), so this
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
