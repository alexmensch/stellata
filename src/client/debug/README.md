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
  render-watch/                   debug.renderWatch() — why is this scene
                                  rendering, or not. A standalone HUD
                                  rather than a panel section, because the
                                  panel holds the gate open. Own README.
  memory/                         debug.memory() — GPU residency + JS-heap
                                  inventory. The perf HUD prices time;
                                  this prices space. Own README.
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

- **`debug.renderWatch()`** — a standalone corner HUD that names why the
  render gate is drawing, or not. It takes **no** gate hold, which is the
  whole point: the panel does, so no section inside it can ever observe
  idling. `render-watch/README.md` owns it, including the panel section
  that closes the panel before starting it.

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
| `submit.localDepth`     | `stellata.ts` `animate()`       | CPU wall-time around the local depth pass's bracketed renders — one per slice on WebGL2, one for the whole bracket under reversed-z (K = 1). |
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

The optimisation ledger lives beside the code each entry describes, so a
session reading that code lands on it:

- **Chart labels** — scratch `Vector3`, pooled per-frame containers, the
  cached brightest constellation member, pre-binned eligibility lists,
  dirty-tracked SVG writes, the full-tick skip, and the three rejected
  alternatives: `../chart-mode/labels/README.md` § What got optimised.
- **`forEachStarNearCamera`** — the sorted-distance binary-search window:
  `../star-pipeline/star-frame/README.md`.
- **Overlay self-gating fast-paths** — `../overlays/README.md`
  § Per-frame cost.

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
isn't dimming from the current vantage, and § Eclipse routing for the
per-member line under it). Drag the
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

### Eclipse routing — finding a band you cannot see

Under each relation the Eclipse section prints a routing verdict per
member. **`>` marks the back member** — the only one carrying a dim, so
the only one whose verdict is live. The other line is the front star and
reads `no dim`; its threshold is what it *would* need half an orbit
later, when the two swap.

A dim can only move a **glow-routed** star, so the verdict leads with
whichever of those two conditions is missing:

| Verdict | Means | Do |
| --- | --- | --- |
| `>pri DISC r=0.545  disc ignores the dim, back off` | The back star is a resolved disc. The disc pass never folds `iEclipseDim`, so the eclipse has **no photometric effect at all** here — overlap orders geometrically in the local depth pass. | Back off until `r` falls under 0.5. |
| `>sec GLOW r=0.426  need r>0.494 at dim 0.139, or trap<0.002` | Glow-routed and dimmed, but the quad is too small a fraction of the split. | Close in until `r` passes the stated target. |
| `>sec GLOW r=0.494  <TRAP>` | **In the band now.** | Look — § What the eye has to settle. |
| `>sec GLOW r=0.426  need r>0.494 at dim 0.139; no dim reaches it here` | Same, and scrubbing will not help either: even totality leaves the quad above the split. | Close in; distance is the only lever left. |

`r` is `vPhysRatio` as the vertex stages compute it — from the
**undimmed** quad, which is what makes all three compilations agree
(`../star-pipeline/README.md` § Star rendering). `need r>` is the value
`r` must reach for the dim the star *already has* to tier it disc-owned:
the camera-side target, against `trap<`'s clock-side one.

**Camera distance is a clean control here.** A dim only shrinks
`appSize`, so `r ≈ physSize / appSize` falls as roughly `1/d` — while the
dim itself is scale-invariant (the occlusion solves from angular
quantities, and separation and disc radii both scale as `1/d`, so their
ratio does not move). Park at the eclipse phase you want, then slide the
camera until `r` crosses `need r>`; the dim will sit still while you do.

**`<TRAP>` is not a fault report.** Past the undimmed-routing fix the
star stays drawn right through it; the marker exists because the band is
otherwise impossible to find.

### What the eye has to settle — the HUD cannot

**This readout cannot validate a routing fix, only locate where one
would show.** Every number in it comes from the CPU mirror
(`renderedSizeComponents`), which has always solved the split from the
undimmed quad. It reads identically against a correct shader and a
broken one. Watching `r` hold steady while the dim swings proves only
that the mirror is undimmed, which was never in doubt.

What the shaders route on is observable in exactly one place: whether
the star is **drawn** while `<TRAP>` is up. So the check is a negative
control, not an inspection — park inside the band, then load a build
without the fix and confirm the star *disappears*. A star that looks
fine in one build is not evidence; a star that vanishes in the other is.

Corollary for anything that changes the sizing curve: this band moves
with `sizeMin`/`sizeMax`/`sizeSpan`/`sizeKnee`, and a star can only fall
into it when the pass split and the footprint disagree about which quad
they are measuring. The source-level pin
(`../star-pipeline/star-pass-split-drift.test.ts`) is what actually
holds that invariant; this panel is for confirming it with your eyes
once, not for regression.

#### The one reproduction anybody has hit — Algol

Found by hand, and worth not re-deriving. Focus **Algol**, take the
`Aa1 → Aa2` relation (B8V primary eclipsed by the K0IV subgiant; the
third line is Algol Ab and the plane prefilter skips it from most
vantages), and park the camera at **≈5.84 AU** at a phase where `Aa1`
is in front, so `Aa2` is the back member:

```
61434→263692 T1 d=5.84AU
  θ/Σα=0.235 front=pri dim→0.193 buf=1.000/0.193
 pri DISC r=0.569  no dim
>sec GLOW r=0.498  <TRAP>
```

`Aa2` lands at `r` = 0.498 — two thousandths under the split — which a
dim of 0.193 is just enough to carry over. Against a build without the
undimmed-routing fix, the same vantage and clock draws **only the
primary's disc**: the secondary is discarded by both colour passes and
contributes nothing. With the fix its glow reappears as a bulge on the
primary's flank. That difference is the whole test.

Getting there: `r ≈ physSize / appSize` falls as roughly `1/d`, so scale
the distance by the ratio of the `r` you have to the `need r>` printed —
6.83 AU at `r` = 0.426 targeting 0.494 predicts 5.9 AU, and 5.84 is
where it actually fired. Star indices are catalog-order and move when
the catalog is rebuilt; the names and the geometry do not.

### Widening the band

Camera distance alone is a poor lever: it has to put the **back** member
just under `r` = 0.5, and a real pair will happily sit with one member
either side of the split while the dimmed one is the wrong one. Two
better knobs, both in the panel's Star disc section:

- **`sizeKnee`** is the one that matters. It sets how far past the
  visible-population window a bright star keeps growing before
  saturating, so it decides how much a magnitude of dimming actually
  shrinks `appSize`. A bright star high on the saturated part of the
  curve barely moves — which is why a `trap<0.003` reads as
  unreachable in practice. Drop `sizeKnee` and the same dim shrinks the
  quad much harder, pulling the threshold up into a scrubbable range.
- **`sizeMin` / `sizeMax`** move `appSize` bodily, so they reposition `r`
  against a fixed `physSize` without touching the camera.

Neither changes what is under test: both feed `appSize`, which is
exactly the term the split is *supposed* to route on, undimmed. Tuning
them relocates the band, it does not fake it.

So the procedure is: focus an eclipsing pair with a renderable orbit,
open the Eclipse section, get `>` onto a `GLOW` member (camera distance,
or wait half an orbit for the pair to swap), then pull `sizeKnee` down
until `trap<` rises past the dim the eclipse actually reaches. Confirm
the star holds through `<TRAP>`. Repeat once resolved (`DISC`), where
the dim must not touch either member at all.

Exposure does **not** move `r`: the split is solved from `appSize`
and `physSize`, and exposure only scales `vPeakL`. So the Exposure
section's knobs are free to use to get a blown-out disc back under
control without perturbing what is being tested — the one coupling is
`uThresholdMag`, which can taper a *faint* star out entirely, so keep to
a bright pair.
