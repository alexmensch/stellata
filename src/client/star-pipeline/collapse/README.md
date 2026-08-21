# Vertex-stage collapse — bounding what an invisible star costs

Invisible is not free: a star whose fragments write nothing still
rasterises a full-size quad and pays read-modify-write blend bandwidth on
every attachment its pass opens. At a deep adaptation cut that is most of
the star field — the statistic-attachment write row measured ~50 % of the
default Sol-view frame (`../../debug/frame-cost/README.md` § Decomposing
the HDR chain). Two vertex-stage mechanisms in `../star.vert.glsl` (TSL
twin: `../../webgpu/star/star-vertex-tsl.ts`) bound that cost. Neither
touches the cull bounds themselves — `uCullMag` stays adaptation-free
(`../../hdr/exposure/README.md` § One writer, five slots).

**Measured after it landed** (Sol, Chrome `timer-query`, 6.774 Mpx): the frame
2.5–3.1× cheaper, ~249–311 ms down to 100.2 ms, and the row's absolute cost
57–68 % lower. Its **share held at 50.6 %** — both attachments' traffic scales
with quad area, so shrinking the quad cuts the display and statistic writes
together and the ~50 % above still describes the frame. Numbers, gates and
instrument: `../../debug/frame-cost/README.md` § Decomposing the HDR chain.

```
src/client/star-pipeline/collapse/
  glow-collapse-pure.ts     The derived display floor the kernel collapse
    (+ test)                compares against. The test pins the GLSL
                            literal and the taper-cull bound.
```

## Taper cull — exact

Past the taper's end a star contributes nothing in any pass: the glow
taper multiplies its kernel to exactly 0, and the disc and core-mask
passes discard every fragment past `uThresholdMag`. The vertex stage
emits the off-screen sentinel there instead — glow at
`appMag ≥ uThresholdMag + SOFT_TAPER_MARGIN_MAG`, disc/core at
`> uThresholdMag`, matching the fragment comparisons exactly (pinned).

Bit-exact by construction: the bound is the LIVE `uThresholdMag`, so the
EV trim moves it exactly as it moves the fragment taper — no population
edge can appear that the taper would not have shown. Chart mode is
exempt; it sizes and clips against `uLimitMag`.

**Attachment 1's alpha is what makes it bit-exact rather than
near-exact.** A tapered-to-zero glow fragment still writes alpha 1 there
(the flux channel must be summed once, not scaled by the kernel again —
`../../hdr/attachments/README.md` § One blend equation), so the additive
blend adds 1 to that channel where a culled quad adds nothing. Nothing
reads it: the reduction takes means of R and G only.

**`starTaperDead` is called twice, and the first call is the point.** A_V
only ever dims, so a star already past the bound before extinction is
past it after — the same monotonicity the magnitude prefilter beside it
runs on. Testing there keeps the extinction read (one `texelFetch` on the
prepass path, the 48-tap raymarch on the fallback) off the whole culled
population; the second call, on the extincted value, is the exact one.
The TSL twin needs one test only because no extinction read is ported yet
(`../../webgpu/star/README.md` § What is deliberately NOT here yet) — when
one lands it wants the same split.

## Kernel collapse — flux-preserving

A glow-pass star can be display-invisible through the live exposure
(adaptation included) while its statistic flux is still real — the
adaptation model reads the full field at base exposure, so the star must
keep writing attachment 1 (`../../hdr/attachments/README.md`). What it
does not need is its display kernel: the quad collapses to `uSizeMin` — a
threshold star's footprint, the size the statistic already trusts for the
whole faint field — and `stellataKernelFluxPeak`'s `Φ(n)·D²` renorm
divides the collapsed size, so attachment 1 receives exactly the flux it
did before at a fraction of the bandwidth.

The predicate is `vPeakL · tap² < GLOW_COLLAPSE_FLOOR_L`. The glow pass's
additive blend multiplies rgb by the fragment's own alpha, so the peak
display light is kernel-squared at the centre; the floor is the operator
inverted at half an 8-bit step (the darkest level the encode
distinguishes from black), held `GLOW_COLLAPSE_STACK_MARGIN` (16×) under
it so 16 collapsed stars stacked on one pixel still cannot reach the
step. Derived, not tuned, and whitePoint-independent to first order
(pinned) — the `DR_MAG` knob cannot move it.

The margin also covers the **off-target** path, where the operator runs
per-fragment and the blend's second multiply lands outside it: the peak
there is `tap·tonemap(vPeakL·tap)` rather than `tonemap(vPeakL·tap²)`, and
the toe's convexity bounds it at the same half-step/16
(`../../hdr/README.md` § Fallback).

Reading the live exposure here is deliberate and allowed: the
no-adaptation rule protects cached and per-frame CPU consumers from
thrash (`../../hdr/exposure/README.md` § One writer, five slots), and
this is a per-instance GPU computation with no cache. The win lands
exactly at deep-cut vantages; at `dm = 0` the floor sits inside the
taper's last scrap, where quads are minimum-size anyway.

What it trades, each bounded by a case already accepted:

- **Occlusion coarsens**: a foreground surface overwrites a collapsed
  star's statistic texels all-or-nothing over `uSizeMin` instead of
  kernel-shaped — the coarseness every threshold star already has.
- **Discretisation** of the flux over a `uSizeMin` quad matches a
  threshold star's exactly, and collapsed stars sit ≥ 16× under the
  darkest visible level, so the reduction's mean moves by fractions of
  contributions that are themselves decades under `L_ADAPT`.
- **Dropped tails**: what a collapsed star stops painting is its kernel
  *outside* the `uSizeMin` quad it keeps, so the dropped part never
  includes its own peak — it is `profile²` past ~1.3 px of a
  super-Gaussian, decades under a floor that is already 16× under the
  darkest visible level. **The bound is that falloff, not a star count.**
  A count would not carry it: in the galactic plane at a deep cut, far
  more than 16 collapsed quads overlap one pixel, so "16 must stack"
  bounds nothing there. What it does bound is the degenerate case of that
  many stars stacking within a pixel of *each other*, where the tails
  being dropped are near-peak.

  Some of the collapsed population is genuinely sub-threshold, and its
  integrated light is the Milky Way band raymarch's job
  (`../../milkyway/README.md`) — those drawn tails double-counted it. That
  argument does **not** extend to a catalogued star collapsed only because
  the live cut is deep: the raymarch integrates the population the
  catalogue lacks, not this one. For those the falloff bound above is the
  whole argument, and a dense faint field is the smoke that tests it.

Resolved (disc-class, `vPhysRatio ≥ 0.5`) stars never collapse: their
core-mask depth stamps and dark-disc silhouettes are visible occlusion,
not display light. Nor can the collapse ever *grow* a quad: `dMEff` floors
at 0, so `appSize ≥ uSizeMin` always, and in the taper band `appSize` is
already `uSizeMin` and the collapse is a no-op there.

The CPU rendered-size mirror (`renderedSizeComponents`) still reports the
uncollapsed `pxSize`, deliberately: every consumer either cannot see a
collapsed star — local-pass membership needs `vPhysRatio ≥ 0.5`, the pick
path excludes them below — or is a debug readout.

The CPU pick/hover mirrors need no change: `emitterPutsInkOnScreen`
(`../../hdr/exposure/emitter-visibility-pure.ts`) excludes every collapsed
star, so none is pickable — swept and pinned in
`glow-collapse-pure.test.ts`.

**It does not follow from the floors alone, because the two predicates
compare different quantities.** The collapse tests `vPeakL·tap²`; the pick
predicate tests `peak·tap`, one factor of the taper short (it models the
off-target multiply order, and erring toward *pickable* is the safe
direction for it). So collapsed-implies-unpickable needs
`tap ≥ 1/GLOW_COLLAPSE_STACK_MARGIN`, and what supplies it is the peak's
own ceiling: a source at the threshold carries `L_THRESH·10^(0.4·dm)` at
most, which puts the pick predicate's last visible pixel 0.31 mag past
threshold, while `tap` falls under 1/16 only past 0.42 mag. The bands do
not touch — the worst collapsed star in the sweep reaches 6 % of the pick
floor.
