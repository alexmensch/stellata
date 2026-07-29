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
                                  readout helpers).
  perf-hud.ts                     Ring-buffer instrumentation +
                                  histogram + per-label table. Module-
                                  level mark/measure/frame/gpuBegin/
                                  gpuEnd swapped from no-op to real on
                                  panel open.
  gpu-timer.ts (+ test)           EXT_disjoint_timer_query_webgl2 wrapper
                                  — real GPU execution time, one rotating
                                  scope per frame. See § GPU timing.
  fake-gl.ts                      Test-only WebGL2 timer-query stub,
                                  shared by gpu-timer + perf-hud tests.
  pin-debug-hud.ts                Pin-to-center diagnostic HUD.
  arrow-fade-debug-hud.ts         Sol/GC arrow shaft-fade diagnostic HUD.
  eclipse-debug-hud.ts            Eclipse-photometry per-relation gate /
                                  geometry readout (focused star, or all
                                  active dims when unfocused).
  star-tuning.ts                  Live-tunable star-disc knobs, plus the
                                  derived-K readout (K, plate scale, FOV,
                                  resulting sizeMin/Max).
  planet-tuning.ts                Reflected-planet-glare peak slider
                                  (uGlareGain — planet glare brightness
                                  vs a star of the same magnitude).
  atmosphere-tuning.ts            Four global atmosphere-scattering
                                  multipliers (density, Rayleigh↔Mie
                                  balance, scale height, sun intensity).
  (+ tests for the pure helpers.)
```

## Running the perf HUD

The HUD is an opt-in dev tool, not a user feature. Activation paths:

- **`debug.panel()`** in the dev console — opens the unified debug
  panel; the Perf section is one of ten
  collapsible sections inside it. Opening the panel installs the
  instrumentation (one-shot, swaps the module-level no-op
  `mark`/`measure`/`frame` functions to real implementations).
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
- **`gpu Xms`** is one query's measurement of a whole frame (the
  `gpu.frame` scope), and appears only where the driver exposes a timer
  query. It is **not** the sum of the `gpu.*` rows — those both rotate
  across frames and over-attribute, so their total runs well above the
  frame period (§ GPU timing). Where the extension is
  absent (Safari exposes none), the headline says **`submit Xms`** instead
  and reports CPU wall-time around the render calls. Submission is
  asynchronous, so a large `submit` means the main thread is *blocking*
  on the driver — a real symptom, but not a measure of GPU work. Never
  compare a `submit` number against a `gpu` one.

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
| `pre-render`            | `stellata.ts` `animate()`       | Per-frame uniform writes + galactic + Milky Way reposition. |
| `extinction.prepass`    | `stellata.ts` `animate()`       | Per-star A_V cache recompute submission (near-zero on skipped frames). |
| `coreMask`              | `stellata.ts` `animate()`       | The binary-search `shouldEnableCoreMask()` (see below). |
| `adaptation`            | `scene-adaptation.ts` `measure()` | Scene-luminance measurement: drawn bodies plus the near-camera star walk, then an O(n²) occlusion pass over what survives the flux gate (`../hdr/exposure/README.md` § Adaptation). Zero in chart mode. |
| `submit.main`           | `stellata.ts` `animate()`       | CPU wall-time around `renderer.render()` — submission, not GPU work. |
| `submit.localDepth`     | `stellata.ts` `animate()`       | CPU wall-time around the local depth pass's per-slice renders. |
| `submit.tonemap`        | `stellata.ts` `animate()`       | CPU wall-time around the HDR resolve. Near-zero while the seam is parked (HDR off, chart mode, no float target). |
| `gpu.frame`             | timer query                      | Real GPU ms for the whole frame — one query spanning every pass. The headline's source, and the only row that prices anything. |
| `gpu.main`              | timer query                      | Main-pass timer scope. Over-attributes — a relative signal, not a cost. See § GPU timing. |
| `gpu.localDepth`        | timer query                      | Local-depth-pass timer scope. Same caveat. |
| `gpu.tonemap`           | timer query                      | Fullscreen HDR resolve timer scope (`../hdr/README.md`). Same caveat. |
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

## GPU timing

`gpu-timer.ts` wraps `EXT_disjoint_timer_query_webgl2`. The extension is
feature-detected at panel open; absent it, `gpuBegin`/`gpuEnd` stay
no-ops and no `gpu.*` rows appear at all.

**One query at a time — this shapes everything.** WebGL2 permits exactly
one active `TIME_ELAPSED` query per context and exposes no timestamp
queries, so timed scopes cannot nest or overlap within a frame. Each
frame times a single scope and rotates to the next, so **N scopes sample
at 1/N the frame rate**. The ring-buffer averages stay meaningful; the
per-frame histogram is still driven by `frame.total`, never by these.

**Never add the `gpu.*` rows together, and never ratio one against
`gpu.frame`.** Two problems compound. Rotation means two scopes never
sample the same frame, so their averages describe different work.
Worse, the per-pass scopes **over-attribute** on ANGLE/Metal: measured
on an M4, `gpu.main` came within 1% of `gpu.frame` while
`gpu.localDepth` was a further 83% of the frame on top of it — a sum of
42.7 ms against a measured frame of 23.4 ms. WebGL2 exposes no timestamp
queries, so elapsed time is derived from pass boundaries, and on a
tile-based deferred renderer a pass's fragment work executes when that
pass is finalised — not necessarily inside the query that encoded it.

`GPU_WHOLE_FRAME_SCOPE` (`gpu.frame`) is the only figure that prices a
frame: one query, no cross-scope arithmetic. **To price a single pass,
disable it and difference `gpu.frame`.** The per-pass rows are a
relative signal — does this scope respond to this change — and nothing
more.

Because `gpu.frame` encloses the inner scopes, `begin()` refuses the
inner ones on its turn and their `end()` calls must leave the enclosing
query running — `endQuery` takes no handle, so closing on a label
mismatch would stop the clock early. Pinned in `gpu-timer.test.ts`.

Two further properties a reader will otherwise get wrong:

- **Results are async** — a query resolves some frames after submission,
  so `gpu.*` rows lag the scene by a frame or two.
- **A disjoint event invalidates everything in flight.** Reading
  `GPU_DISJOINT_EXT` clears it, so it is read exactly once per drain and
  applied to every result in that pass; those samples are dropped, not
  reported low.

Adding a GPU scope: wrap the draw in `gpuBegin('name')` / `gpuEnd('name')`.
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

`star-pipeline/star-frame.ts`. The core depth-mask gate
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

- No name is drawn at all — `showConstellation` off (`C`) or the
  declutter floor withholding `chartConstellationNames` — in which
  case the walk is skipped outright, not cached.
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
3. If `gpu.render` dominates, the bottleneck is in shaders /
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
collapsible host with ten sections:
Star disc (`star-tuning.ts`),
Planet glare (`planet-tuning.ts`),
Atmosphere (`atmosphere-tuning.ts`),
Milky Way (`milkyway-tuning.ts`), Deep field (`local-group-tuning.ts`),
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
