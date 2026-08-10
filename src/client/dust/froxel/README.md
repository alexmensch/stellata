# Band measured-dust froxel grid — the fill pass

The A_V column the Milky Way band's march will read, held per
(screen cell × log-distance slice) and rebuilt from the Edenhofer voxel
texture whenever the view changes. `docs/science-galactic-structure.md`
§ The prefilter mechanism is the contract; this folder implements the
**fill** half of it and nothing else. The read, the per-cloud tiering
and the band's consumption of the grid are not here yet.

**Measurement code, not a shipped feature.** It exists to turn the design
gate's exact fetch counts into GPU frame times before the read is built on
top of them, and it is **parked by default** — nothing allocates and nothing
runs until `stellata.setFroxelFillEnabled(true)`. Turn it on and the fill
costs multiples of the per-star extinction prepass on every frame the camera
moves; that cost is the thing being measured.

```
src/client/dust/froxel/
  froxel-pins.ts          The pinned geometry the fill, the accuracy sweep
                          (scripts/dust/prefilter/) and the cost model all
                          read: cell angle, slice count, fill rate. The cell
                          angle is DERIVED from DEFAULT_SUMMATION_ARCSEC2 —
                          an instrument change moves the grid with it.
  froxel-grid-pure.ts     Tan-space cell counts, the coverage-sphere span a
    (+ test)              cell ray marches, log slice edges, and the two
                          rebuild predicates.
  froxel-fill.frag.glsl   One layer of the fill: ray per cell, march over
                          that ray's own slice shell.
  froxel-fill-spike.ts    FroxelFillSpike — the array render target, the
                          per-layer draws, the rebuild gate, the stats the
                          readout and the benchmark share.
  froxel-benchmark.ts     debug.froxelBench() — batched EXT_disjoint_timer
                          _query_webgl2 timings swept over FOV × pixel ratio.
  froxel-debug-hud.ts     The panel's Froxel section: grid geometry, the
                          predicted fetch count, and the rebuild rate.
```

## Three things the code cannot tell you

- **A screen-space grid is uniform in tan θ, not in solid angle.** `dθ/dx =
  cos²θ`, so the on-axis cell is the *coarsest* and holding it at the pin
  costs the tan-space area — 1.42× a solid-angle count at 50° FOV and 5.51×
  at 120°. `frustumCells` owns that distinction and
  `scripts/dust/prefilter/cost-pure.ts` prices the sky-fixed alternative
  against it.
- **The distance axis is per-ray `[entry, exit]`, not `[0, exit]`.** Each
  cell log-spaces its 32 slices over its own coverage-sphere span, which is
  the whole of the design gate's fourth requirement: from 3 kpc out the
  slices sit on the shell that actually holds data instead of on 1.75 kpc of
  vacuum, and a ray missing the sphere writes zero without a single fetch.
- **The fill is dpr-invariant by construction.** Cells are angular, so the
  grid at dpr 2 is the same grid as at dpr 1 — the pixel ratio moves the
  *read* (per band pixel) and the frame around it, never this pass. The
  benchmark still sweeps it, because the only way dpr can reach the fill is
  contention with a 4×-heavier frame.

## Pins and gates

- **13.0′ cells × 32 slices × half-voxel fill** (`froxel-pins.ts`). Cell
  angle is one summation-patch diameter — the display carries nothing finer,
  and neither does the source (a voxel subtends 13.43′ at the coverage edge).
  Half a voxel is the knee on fill rate, not a guess:
  `docs/science-galactic-structure.md` § What is not measured prices both
  directions.
- **Storage is R16F, 2 bytes per texel** — the cost table's currency.
  `WebGLArrayRenderTarget` builds its own texture *after* applying the
  options object, so the format has to be set on `rt.texture` afterwards;
  miss it and the grid quietly allocates RGBA8 and prices the wrong thing.
- **Rebuild gate: displacement ε OR rotation ε.** A view-parameterised grid
  is stale the moment the camera turns, so the per-star prepass's 1 pc
  displacement predicate is reused *and* paired with a rotation ε of a fifth
  of a cell (`ROTATION_EPSILON_RAD`), matching that ε's fifth-of-a-voxel
  ratio. Both sentinels (Infinity position, NaN quaternion) must fail their
  first comparison; `rotatedBeyondEpsilon` is written as a negated `>=` for
  exactly that reason.
- **`MAX_FILL_STEPS = 256`** bounds the shader's march loop. The worst
  single shell is the outermost one of a ray crossing the full 2 × 1250 pc
  chord — 223 steps at the pin. Change the cell angle or fill rate and the
  bound needs re-deriving; `froxel-grid-pure.test.ts` pins it.
- **Slices store their own segment's column, not the cumulative one.** That
  is what makes the total 512 fetches per ray rather than quadratic in the
  slice count. The read differences two slices, so a prefix pass over the
  32 layers (one texel read each, against an average of 16 dust fetches per
  texel here) is the read's problem and is **not** priced by this pass.

## Running the benchmark

`debug.froxelBench()` from the dev console. It enables the fill, sweeps
FOV × pixel ratio from wherever the camera currently is, and prints a table
of ms per fill with the grid geometry and predicted fetch count beside it.
Batches of fills are timed as a unit, so the number is not diluted by query
overhead or by the pass-boundary over-attribution that makes the perf HUD's
per-pass `gpu.*` rows a relative signal only (`../../debug/README.md`
§ GPU timing).

**Two clocks, and they are not comparable.** The `method` column says which
one produced the row; carry it with any number that leaves the console.

- **`timer-query`** — `EXT_disjoint_timer_query_webgl2` around the batch.
  Real GPU execution time. Chrome, Firefox.
- **`fence-delta`** — Safari exposes no timer query at all, so the fallback
  submits N fills and 2N fills, fences each, spins on `clientWaitSync`
  (WebGL2 pins its timeout at 0), and takes the **slope**: `(t₂ₙ − tₙ) / N`
  cancels submission, fence latency and the spin's granularity, none of
  which scale with N. The absolute times are unusable; the slope is the
  measurement.

**Run it on both, and record which.** Safari drives Metal directly where
Chrome goes through ANGLE's translation layer, so the two can differ by more
than the pin does — a fill that misses on Chrome and lands on Safari is a
different decision from one that misses on both. Neither browser is "the"
answer on its own.

**The frustum is pinned, not inherited.** The grid is sized from the camera's
aspect, so a reading taken in whatever shape the window happens to be is
comparable only to that window — a 0.97-aspect window prices *half* the cells
a 16:9 one does at the same FOV. The bench holds the grid at 16:9 (the cost
table's aspect) through `setAspectOverride`, reports it in the `aspect`
column, and restores the live aspect afterwards. Pass
`{aspect: stellata.camera.aspect}` to price your own window instead.

- **Close the debug panel first** on the timer-query path. WebGL2 allows one
  `TIME_ELAPSED` query per context; an open Perf section holds it and every
  batch times out.
- **Never poll a fence in a spin loop.** `clientWaitSync`'s timeout is pinned
  at 0 in WebGL2, and a busy-wait on the main thread hangs the tab outright —
  the fence's completion arrives through the same event loop the spin is
  starving. The fence path polls across rAF for that reason, which is what
  quantises it to the frame period and why only the slope is usable.
- **The camera pose is an input.** Sol is the easy case. Fly ~3 kpc out and
  run it again to see the ray-sphere gate collapse the cost — only ~4.5 % of
  sightlines cross coverage from there.
- **Cross-check with the A/B.** `stellata.setFroxelFillEnabled(true/false)`
  with the Perf section open differences `gpu.frame` on identical scenes,
  which is the debug README's canonical way to price one pass.
- The rebuild rate matters as much as the per-fill cost: the Froxel section's
  "fills per 60 frames" must sit at **0** with hands off the controls.
