# Performance instrumentation + optimisations

How to profile a running build, what's already been tuned, and where to
look first when something feels slow.

## Files in this area

```
src/client/debug/
  debug.ts                        Dev console handle (`window.debug`
                                  surface). Owns the panel-open path.
  debug-panel.ts                  Unified debug panel chrome (drag
                                  handle, collapsible sections, slider /
                                  colour helpers). `makeMonoReadout` is
                                  the green-on-black block every live
                                  readout writes through `setReadoutText`
                                  (§ Live readouts) —
                                  `buildDiagnosticReadout` is it plus the
                                  latch-reset link.
  perf-hud.ts                     Ring-buffer instrumentation +
                                  histogram + per-label table. Module-
                                  level mark/measure/frame/gpuBegin/
                                  gpuEnd swapped from no-op to real on
                                  panel open.
  gpu-timing/                     Where the gpu.* rows come from, per
                                  backend: the WebGL2 rotating timer, the
                                  WebGPU frame-sample channel, the GL test
                                  stub. Own README.
  frame-cost/                     debug.priceFrame() — automated per-pass
                                  gpu.frame differentials. Own README.
  pin-debug-hud.ts                Pin-to-center diagnostic HUD.
  arrow-fade-debug-hud.ts         Sol/GC arrow shaft-fade diagnostic HUD.
  eclipse-debug-hud.ts            Eclipse-photometry per-relation gate /
                                  geometry readout (focused star, or all
                                  active dims when unfocused).
  star-tuning.ts                  Live-tunable star-disc knobs, plus the
                                  derived-K readout (K, plate scale, FOV,
                                  resulting sizeMin/Max).
  (+ tests for the pure helpers.)
```

## Running the perf HUD

The HUD is an opt-in dev tool, not a user feature. Activation paths:

- **`debug.panel()`** in the dev console — opens the unified debug
  panel; the Perf section is one of nine
  collapsible sections inside it. Opening the panel installs the
  instrumentation (one-shot, swaps the module-level no-op
  `mark`/`measure`/`frame` functions to real implementations) and
  holds the render gate open, so every tick renders while the panel
  is up (`../render-gate/README.md`).
  Calling again closes the panel, which disposes every section — the
  Perf section's dispose re-arms the no-op `mark`/`measure`/`frame`
  stubs and clears the ring buffers, so a re-open starts fresh with an
  empty histogram. While the panel stays open, collapsing the Perf
  section gates per-tick DOM writes but not the ring-buffer fills.
  **Every section opens collapsed** and each remembers its own state in
  `sessionStorage` (`stellata.debug.collapsed.<key>`), so expand what you
  need once and it stays expanded for the tab's lifetime.

There is **no URL param and no keyboard shortcut.** Both paths existed
during the original profiling work and were removed deliberately —
end users could land on the HUD by accident, and the data is only
useful to a developer who can read the section labels.

The Perf section shows three rolling-window stats up top
(`FPS avg`, `low`, `gpu`/`submit Xms`) over a sortable section table
(top 8 by avg ms, descending) and a 60-frame `frame.total`
histogram. The DOM updates at ~5 Hz so the panel itself doesn't show
up as a hot path in its own measurements.

**Read the headline literally — the two numbers mean different things.**

- **`FPS` / `low`** are the real displayed rate, from rAF-to-rAF deltas
  (`low` inverts the *slowest* frame in the window). They are NOT
  `1000 / frame.total`: that inverts how much work a frame does, which
  reported "347 FPS" on a 60 Hz display whenever the work was cheap and
  invited nonsense cross-browser comparisons.
- **`gpu Xms`** is a whole-frame GPU measurement (the `gpu.frame` scope),
  and appears wherever the backend can produce one: a WebGL2 timer query,
  or the WebGPU renderer's own timestamps
  ([`gpu-timing/`](gpu-timing/README.md)). It is **not** the sum of the
  per-pass `gpu.*` rows — on WebGL2 those rotate across frames and
  over-attribute, so their total runs well above the frame period.
  Where the backend offers nothing — WebGL2 Safari exposes no timer query,
  a WebGPU adapter can withhold `timestamp-query`, and Chrome grants it but
  resolves garbage ([`gpu-timing/`](gpu-timing/README.md) § A granted
  feature can still resolve garbage) — the headline says
  **`submit Xms`** instead and reports CPU wall-time
  around the render calls. Submission is asynchronous, so a large `submit`
  means the main thread is *blocking* on the driver — a real symptom, but
  not a measure of GPU work. Never compare a `submit` number against a
  `gpu` one.

## Instrumented sections

The instrumentation is structured as named `mark`/`measure` pairs that
write into per-label ring buffers (60 frames) and an end-of-frame
`frame()` that flips them. Sections silent for a full ring window
get garbage-collected so e.g. `chart.*` entries drop off the HUD
after exiting chart mode (otherwise the average would lag forever).

| Label                   | Where (`src/client/`)            | What it measures |
| ----------------------- | -------------------------------- | ---------------- |
| `frame.total`           | `stellata.ts` `animate()`       | Full frame body, the histogram source. |
| `controls.update`       | `stellata.ts` `animate()`       | TrackballControls / observe-controls update branch. |
| `pre-render`            | `stellata.ts` `animate()`       | Per-frame uniform writes **and the whole layer fan-out** (`layers.updateAll` — star frame, binaries, planets, Milky Way, galactic, clouds), plus the adaptation fold and core-mask gate. Normally the largest CPU section, and it *contains* the `extinction.prepass` / `coreMask` rows below rather than sitting beside them. |
| `extinction.prepass`    | `stellata.ts` `animate()`       | Per-star A_V cache recompute submission (near-zero on skipped frames). |
| `coreMask`              | `stellata.ts` `animate()`       | The binary-search `shouldEnableCoreMask()` (see below). |
| `adaptation`            | `scene-adaptation.ts` `measure()` | Folding the landed reduction into the applied cut — a handful of arithmetic, since the measurement itself is GPU work priced under `submit.reduction` / `gpu.reduction` (`../hdr/exposure/README.md` § Adaptation). Not measured in chart mode — the row goes quiet like any silent section. |
| `submit.main`           | `stellata.ts` `animate()`       | CPU wall-time around `renderer.render()` — submission, not GPU work. |
| `submit.localDepth`     | `stellata.ts` `animate()`       | CPU wall-time around the local depth pass's per-slice renders. |
| `submit.tonemap`        | `stellata.ts` `animate()`       | CPU wall-time around the HDR resolve. Near-zero while the seam is parked (HDR off, chart mode, no float target). |
| `submit.reduction`      | `stellata.ts` `animate()`       | CPU wall-time around the statistic attachment's mip reduction. Zero on frames whose readback has not landed, and in chart mode (`../hdr/exposure/reduction/README.md` § Latency). |
| `gpu.frame`             | timer query / timestamps         | Real GPU ms for the whole frame — one WebGL2 query spanning every pass, or the summed WebGPU per-pass timestamps. The headline's source, and the only row that prices anything. Both backends. |
| `gpu.main`              | timer query (WebGL2)             | Main-pass timer scope. Over-attributes — a relative signal, not a cost. Every per-pass row below is WebGL2-only (`gpu-timing/README.md`). |
| `gpu.localDepth`        | timer query (WebGL2)             | Local-depth-pass timer scope. Same caveat. |
| `gpu.tonemap`           | timer query (WebGL2)             | Fullscreen HDR resolve timer scope, **including** the rod-summation downsample it runs first (`../hdr/summation/README.md`). Same caveat. |
| `gpu.reduction`         | timer query (WebGL2)             | The chain of ever-smaller weighted-mean draws down to one texel. Same caveat. |
| `frame.handlers`        | `stellata.ts` `animate()`       | The full `'frame'` emit loop (overlays, chart labels). |
| `solar.bodies`          | `planet-body-field.ts` `update()` | Ephemeris walk + eclipse-dim collection across attached hosts. |
| `solar.mesh`            | `planet-mesh-layer.ts` `update()` | Mesh-LOD per-body uniforms, casters, rotation, ring + atmosphere shells. |
| `solar.rings`           | `orbit-rings-layer.ts` `update()` | Geometry drift check, pixel-gap visibility, anchored-line rebake. |
| `chart.names`           | `chart-labels.ts` `tick()`       | Proper-name label projection + culling. |
| `chart.bayer`           | `chart-labels.ts` `tick()`       | Bayer-letter Greek-glyph pass. |
| `chart.constellations`  | `chart-labels.ts` `tick()`       | Constellation centroid recompute + label placement. |
| `chart.clouds`          | `chart-labels.ts` `tick()`       | Molecular cloud labels. |
| `chart.collision`       | `chart-labels.ts` `tick()`       | Sort + greedy AABB collision pass. |
| `chart.dom`             | `chart-labels.ts` `tick()`       | SVG attribute writes for surviving labels. |
| `chart.glyphs.var`      | `chart-labels.ts` `tick()`       | Variable-ring `<circle>` projection + emission. |
| `chart.glyphs.bin`      | `chart-labels.ts` `tick()`       | Binary-wing `<line>` projection + emission. |

## Where the numbers come from — and when not to trust them

Every CPU row is a bare `performance.now()` delta into a 60-frame ring; no
User Timing entries, no observers. So a row reports real elapsed wall time
inside its bracket, and nothing the HUD does scales with how much the
browser is instrumenting.

The environment does, though. **Safari 26 with Web Inspector open against
the dev server runs the fan-out ~50× slower — `pre-render` 2 ms → 100 ms,
and the frame rate collapses with it, so the work really is that slow
rather than misreported.** Scope, measured: Safari only (Chrome DevTools
shows no effect at all), dev server only (a production build is clean),
and identical on both renderer backends. It is not the HUD, and it is not
logging — nothing in the fan-out logs per frame and the prod build strips
no `console` calls — so it is deoptimised execution of Vite's unbundled
module graph, a cost the shipped app never pays. **Take Safari CPU numbers
from a production build, or with the inspector closed.** Under the
inspector even the *ratios* between rows are unusable: the per-star loops
lose far more than the DOM and submit rows do.

Second comparison trap while the port is in flight: a `#renderer=webgpu`
boot draws an **empty scene** (`../webgpu/README.md`), so its rows read
fast for a reason that has nothing to do with WebGPU. Cross-backend
numbers only mean something once a port child actually draws stars.

## GPU timing

Own folder — [`gpu-timing/README.md`](gpu-timing/README.md) covers both
backends: the WebGL2 one-query-at-a-time rotation and why its per-pass
rows can be neither summed nor ratioed, the WebGPU per-pass timestamps
that make `gpu.frame` an exact total and leave no per-pass rows at all,
and the resolve-every-frame invariant.

The two rules a reader needs before looking at any `gpu.*` row:
`gpu.frame` is the only figure that prices a frame, and **to price a
single pass, disable it and difference `gpu.frame`** — automated below.

## Frame pricing — `debug.priceFrame()`

The automated form of "disable it and difference `gpu.frame`": dwell,
re-dwell with one pass disabled, difference the medians. Lives in its
own folder — `frame-cost/README.md` owns the priced-pass roster, the
preconditions (camera still, clock paused, and on WebGL2 a CLOSED panel),
the drift bracketing, and how to read `noiseMs` / `bracketMs` / `iqrMs`.

Adding a WebGL2 GPU scope: wrap the draw in `gpuBegin('name')` / `gpuEnd('name')`.
The label lands as `gpu.name`; pair it with a `submit.name` CPU measure so
the two are comparable when the extension is missing.

Adding a measurement: import `mark`/`measure` from `perf-hud.ts` and
wrap the block. Both functions are unconditional — when
`buildPerfSection` has not yet been called they're a single indirect
call to a no-op, V8 inlines them fine. Don't subscribe the HUD itself
to the `'frame'` event; the `frame()` flush runs once per render after
`frame.handlers` has finalised, so its DOM update doesn't leak into
the measured numbers.

## What got optimised

Ordered by impact. Each item shipped as a separate commit.

### `forEachStarNearCamera` — sorted-distance binary-search window

`star-pipeline/star-frame/star-frame.ts`. The core depth-mask gate
(`shouldEnableCoreMask`) and the star local-depth membership scan
both need "which stars sit
within `dThresh` pc of the camera?" The original implementation
scanned all 313k positions every frame in every mode.

Build-time setup: sort the indices by distance from Sol once; store
the sorted index and parallel distances as `Uint32Array` +
`Float32Array`. At query time, compute
`camDistFromSol = (camera.position + worldOffset).length()` (the
absolute frame, not the floating-origin local frame), binary-search
for `[camDistFromSol − dThresh, camDistFromSol + dThresh]`, and
walk only that window. Triangle-inequality guarantees no candidate
falls outside it.

Typical window: 50–500 candidates instead of 313k.

### Chart-labels: scratch `Vector3` for projection

`chart-labels.ts:136`. `projectVec()` originally allocated a fresh
`Vector3` per call via `p.clone().applyMatrix4(...)`. With four
candidate sets (proper names, Bayer, variables, binaries) that's
5–15k Vector3 allocations per frame, the dominant GC pressure
source.

Replaced with a module-level `projVec` scratch deliberately
*not* aliased with the existing `tmpV3` — the latter is held
across the projection in `projectStar`, so a shared scratch would
clobber the input.

### Chart-labels: cached brightest constellation member

The Latin names are placed from the shipped region anchors, so the
per-member walk survives only as the **visibility gate**: a region
whose brightest member is under the magnitude limit goes unnamed,
and the apparent magnitude that decides it depends on the camera
position (88 constellations × ~30 members, `Math.pow` per member).
It barely moves under camera translation, since a constellation
spans hundreds of pc and the camera typically moves ≪ 1 pc per
frame.

Cache `minAppMag` per constellation and walk only when:

- No name is drawn at all — the declutter floor withholding
  `chartConstellationNames` — in which case the walk is skipped
  outright, not cached.
- Otherwise: camera moved more than
  `√BRIGHTEST_RECOMPUTE_DIST_SQ ≈ 0.5 pc` since the last walk, or
  the filter version bumped (via `stellata.on('filter', …)`).

The **sentinels are stamped only where the walk actually runs.**
Stamping them on a skipped walk leaves `minAppMag` at its `Infinity`
seed while the cache reads as fresh, so names re-enabled within the
0.5 pc threshold and without a filter change draw nothing —
`chart-labels.test.ts` pins both halves.

Anchors are still re-projected every frame (89 cheap matrix
transforms); it is the inner per-member loop that's elided.

`startChartLabels()` initialises `lastBrightestCamPos` to NaN so the
first frame after entering chart mode always walks.

### Chart-labels: pre-binned eligibility lists for variables + binaries

`chart-labels.ts:120`. The variable / binary index lists run to a
few thousand entries. Each frame the previous code walked the full
list, applied the spectral-mask + min/max distance-from-Sol gates
(static parts of `renderableAppMag`), then projected.

Pre-bin into `variableEligible` / `binaryEligible` on filter change
(via `stellata.on('filter', …)`); the per-frame loops drop the
spectral + distance-from-Sol checks because eligibility already
encodes them, and the cheap remaining work (magnitude gate +
projection) only runs against the pruned set. Restrictive filters
typically cut the eligible set by 80–90%.

This pass also reordered the loops so the `appMag > drawCutoffMag`
test runs *before* projection (free win — pure reorder).

### Chart-labels: dirty-tracked SVG attribute writes

`chart-labels.ts:132`. `setAttribute` triggers SVG attribute
parsing + style invalidation even when the new value matches the
old. The pooled label / circle / line objects now cache the last
written `x` / `y` / `cx` / `cy` / `r` / `x1` / `x2`. Skip the
write when the new value differs by less than `ATTR_DIRTY_PX = 0.05`
(matches the `.toFixed(1)` display precision so visually identical
attributes are coalesced). Drives `chart.dom` toward zero on a
stationary camera.

### Chart-labels: full-tick skip when nothing changed

`chart-labels.ts`. The chart label engine's output is purely a
function of camera pose, filter state, viewport size, and the
advanced catalog epoch (`stellata.advancedEpochJyr` — time scrubbing
re-advances star positions with the camera still, and the glyphs
must follow) — variable pulsation animates on the GPU, the CPU
labels don't otherwise move. Hash that tuple at the top of `tick()`:

```ts
camera.position.equals(lastTickCamPos) &&
camera.quaternion.equals(lastTickCamQuat) &&
filterVersion === lastTickFilterVersion &&
w === lastTickViewportW &&
h === lastTickViewportH &&
epochJyr === lastTickEpochJyr
```

When all six match, the entire body returns early before any
projection. NaN sentinels on `startChartLabels()` entry guarantee
the first frame after engaging chart mode always runs.

This is the asymptote: idle chart-mode CPU cost approaches
navigate-mode idle cost.

### Overlay self-gating fast-paths

`distance-vector-overlay.ts`, `poi-overlay.ts`,
`focus-ring-overlay.ts`. Each overlay subscribes to `'frame'` and
runs every frame regardless of state. The empty-state path (no
focus / no vector) bails in <10 ns before doing any DOM work.
Visibility transitions are tracked via a local boolean so
`hide()` / `show()` are idempotent — no redundant `display`
mutations or `setAttribute` sweeps when the state didn't change.

Don't unsubscribe / resubscribe — the on/off churn is fragile
and the static fast-path is enough.

## What we deliberately did *not* do

Each was considered and rejected; flagged here so it doesn't get
re-prosecuted.

- **Throttle the chart engine to 30 Hz.** Tempting on idle, but
  observe-mode look-around drag is the case where the engine is
  most active, and 30 Hz labels against 60 Hz GPU render stutter
  visibly. The full-tick skip (above) gets the same idle win
  without the regression risk.
- **Move label projection to GPU (transform feedback / compute).**
  Would require rebuilding chart-mode rendering as instanced quads
  with a glyph atlas, throwing away CSS theming, crisp DPI scaling,
  and accessibility text. The CPU side is close enough to free with
  dirty tracking.
- **Optimise the O(n²) collision pass.** Bounded by accepted-label
  count (a few hundred); not the bottleneck. `chart.collision`
  consistently shows up below `chart.dom` in HUD readings.

## Where to look first when something is slow

1. Open dev console, run `debug.panel()` and expand the Perf section.
   Sit in the suspect mode
   for ~5 s with hands off; then again under typical interaction.
2. Read the section table top-down. The histogram tells you whether
   it's a sustained cost or a periodic spike.
3. If `gpu.frame` dominates, the bottleneck is in shaders /
   overdraw — start with whichever render layer (star, milkyway,
   dust, …) is hot.
4. If `frame.handlers` dominates and it's not chart mode, suspect a
   per-frame overlay; check the self-gating fast-paths haven't
   regressed.
5. If `chart.*` dominates, the eligibility lists or centroid cache
   may have invalidated unexpectedly — check whether the `'filter'`
   event is firing more than expected.


## Debug panel

`window.debug.panel()` toggles the unified debug panel — a draggable,
collapsible host with nine sections:
Exposure (`../hdr/exposure/exposure-tuning.ts` — the exposure statistic,
the three adaptation branches and which governs, the exposure
decomposition, over `L_ADAPT` / `L_TARGET` / slew τ / `DR_MAG` /
desaturation; `../hdr/exposure/README.md` § Debug panel),
Star disc (`star-tuning.ts`), Milky Way (`milkyway-tuning.ts`), Deep field (`local-group-tuning.ts`),
Perf (`perf-hud.ts`), Pin (`pin-debug-hud.ts`), Arrows
(`arrow-fade-debug-hud.ts`), Warp (`warp-tuning.ts`), and Eclipse
(`eclipse-debug-hud.ts` — per-relation gate verdict, camera distance,
rendered pair separation vs disc-radius sum, θ/Σα ratio, front/back,
target and buffered dim; the fastest way to see WHY a pair is or
isn't dimming from the current vantage). Drag the
title bar to move it, click any section header to fold/unfold; both the
position and per-section collapse state persist in `sessionStorage`
(resets on reload, since calibration state shouldn't survive between
sessions). The chrome (drag handle, collapsible-section helper,
slider/colour helpers) lives in `debug-panel.ts`. Add a new section by
writing a builder returning a `DebugSection`
(`{element, dispose, setVisible}`) and appending an entry to the
`sections` array in `togglePanel` (debug.ts). Static slider banks use
no-op dispose + setVisible; live readouts own their per-frame
subscription and gate DOM writes on `setVisible`.

### Live readouts — write through `setReadoutText`

**A per-frame readout must never assign `textContent` directly.** The
assignment replaces the text node, which collapses any selection over it —
so a block updating every frame cannot be drag-selected at all, and the
numbers in it cannot be copied out. `setReadoutText` holds the write while
a selection touches the element (`selectionTouches` in
`debug-panel-pure.ts` tests both directions: a drag *within* one readout,
and one *spanning* several sections). It owns the identical-text dedupe
too, so a section keeping its own `last` cache is duplicating it.

Readouts wrap rather than scroll (`white-space: pre-wrap`): the panel is
`PANEL_WIDTH` = 300 px, and a row wider than that used to run under the
edge with only a hidden horizontal scrollbar to reach it.
