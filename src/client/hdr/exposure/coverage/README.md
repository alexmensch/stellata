# Occluder coverage — measured on the GPU, not modelled on the CPU

How much of a light source the camera can actually see, for the
exposure-adaptation statistic (`../README.md` § Adaptation). One scalar
per source per frame: the mean throughput over its screen footprint.

## Why this exists

The statistic's occlusion term was screen-space circle-circle lens area
against each nearer drawn disc. A circle takes the body's **equatorial**
radius, so an oblate body over-occludes at its poles: Saturn's flattening
is 0.098, which puts the real polar limb at 90.2% of the circle. A star
just past the pole reads as hidden while it is plainly visible, the
statistic drops it, and the exposure never cuts — the reported defect.

Every fix that stays on the CPU is another mirror of geometry the GPU has
already rasterised (circle → ellipse → oblate spheroid → rings → moons),
and each one drifts from the shader it mirrors. So measure the rendered
geometry instead.

**Why this is not an occlusion query.** WebGL2 exposes only
`ANY_SAMPLES_PASSED` — a boolean, never a fragment count — so a query
cannot produce a fraction. That limitation rules out the query API; it
does not rule out counting in a shader, which is what this does.

## Files

```
src/client/hdr/exposure/coverage/
  coverage-pure.ts (+ test)  The math. Only `coverageBracket` and
                             `visibleFraction` are called at runtime; the
                             rest is the EXECUTABLE SPEC the shader is
                             pinned against, not a CPU mirror anything
                             invokes — don't go looking for the caller.
                             Covers the perspective depth inverse and its
                             forward mirror, the two distance conventions
                             (§ Axis depth), the per-source self-occlusion
                             slack, the deterministic tap set and its
                             mean, ring slant transmission and the
                             ray/annulus test, and the single-bracket
                             depth range. Pinned against the reported
                             Saturn-vs-Sol geometry and the real ring
                             strip values.
  coverage-pack-pure.ts      The round trip's bookkeeping: source texels
    (+ test)                 out, throughput keys back, ring-slot packing
                             and the unused-slot sentinel. Split from the
                             pass so the key↔texel correspondence
                             (§ Latency) is testable with no GL context.
  coverage.frag.glsl         The measurement — one fragment per source.
                             Re-declares every constant and formula above;
                             nothing here is reachable from vitest, so
                             coverage-glsl-drift.test.ts pins the literals
                             and the expression shapes against the TS,
                             including § Reading textures here.
  coverage-pass.ts           CoveragePass — the occluder-depth target, the
                             source upload, the two renders, and the
                             transmission map the statistic reads. Needs a
                             live GL context, hence no test of its own.
  coverage-readback.ts       The pixel-pack buffer + fence (§ Latency).
```

## The measurement

One fragment per source. Each takes `COVERAGE_TAPS` (64) equal-area taps
over that source's **visibility disc** — `visibilityDiscRadiusPx`, the
same disc the CPU clipping term integrates (§ Composition), which is the
flux footprint widened to `ADAPT_EDGE_RAMP_PX` across. Each tap asks two
questions:

1. **Is an opaque surface nearer than the source?** Sample the
   occluder-depth texture, invert the bracket's projection to recover a
   view distance, compare. `tapOccluded` carries the two guards.
2. **How much do rings let through?** Analytic ray/ring-plane
   intersection, radius → strip U, and `ringTransmission` on the strip's
   authored alpha.

A tap contributes 0 if occluded, else its ring transmission — so the
result is a **throughput in [0, 1]**, not an occluded/clear count. Rings
are why: they are not opaque, at any of the three ring systems the app
ships (§ Rings).

Equal-area stratification puts the sampling error on a fraction at
~`1/(2√K)` = 6% at 64 taps, against the 10% the circle got wrong on
Saturn's flattening alone.

Taps that fall outside the frame leave **both** sides of the mean. The
clipping term already owns them, and counting them here would charge the
same loss to the product twice.

### Axis depth, not radial distance

`LuminanceSample.cameraDistancePc` is a **radial** camera distance; a
depth buffer stores the **view-axis** one. Off-axis the two differ by
`1/cos`, which at the corner of a 16:9 frame with a 50° vertical FOV is
28% — against a slack of 0.1%. Compare them directly and every
off-centre source reads as occluded by its own depth stamp, which is the
original bug with the sign flipped.

`viewRayLength` is the whole conversion (`axialFromRadial` /
`radialFromAxial` are the two directions), and the shader derives it from
the same `uTanHalfFov` it builds tap rays with. The ring pass needs the
radial form back, because a ray parameter is a radial distance.

### The slack is the source's own radius

A source drawn into the occluder scene stamps its own depth, so a tap has
to reject surfaces that *are* the source. A fixed relative slack cannot
do it: **a resolved body's near surface sits a full radius in front of
its centre** — 20% of the distance at a 5-radius framing — so the frame's
dominant source would occlude itself and vanish from the mean.

`selfOcclusionSlackPc` therefore takes the source's own angular radius,
`footprintRadiusPx / pxPerRadian · depth`, which **is** its physical
radius once resolved, and floors it at `SELF_OCCLUSION_SLACK` of the
depth for anything that isn't. `uPxPerRadian` is the same `angularToPx`
the sample's `diameterPx` was measured with, so the shader inverts it
exactly.

### Reading textures here — two rules a normal shader doesn't need

This pass rasterises **one fragment per source**, so neighbouring
fragments are unrelated sources rather than neighbouring pixels of one
surface. Both consequences are invisible until they aren't:

- **Every sample is `textureLod(..., 0.0)`.** `dFdx` of a strip `U` or a
  tap `uv` is a difference between two *different sources*, so the
  implicit-derivative mip choice is arbitrary — and the ring strips ship
  through `THREE.TextureLoader`'s defaults, mipmapped with a
  trilinear min filter. An implicit read lands on a level that averages
  the whole radial profile, collapsing Saturn's C ring, Cassini Division
  and B ring to one mean alpha. (The sampling also sits in non-uniform
  control flow, where implicit LOD is undefined outright.)
- **Precision is declared for `int` and `sampler2D`, not just `float`.**
  The GLSL ES 3.00 fragment defaults are `mediump int` and **`lowp
  sampler2D`**. `uSources` carries parsec distances near `1e-8` and CSS-px
  centres past `1e3`; lowp spans ±2 at ~2⁻⁸ and mediump float bottoms out
  near `6e-5`, so any implementation that honours them reads zero
  distances and clamped centres. Desktop drivers promote silently, mobile
  ones frequently don't.

## The depth bracket — a dedicated pass, deliberately

The occluders are rendered into **their own target at
`COVERAGE_DEPTH_SCALE` (½) per axis — a quarter of the pixels — under a
single `[near, far]` bracket**, not sampled from the local depth pass's
attachment. Three reasons, each load-bearing:

- **The local pass clears depth between slices.** It renders far→near
  with `clearDepth()` between brackets (`../../../local-depth/README.md`
  § Depth slices), so only the nearest slice's depth ever survives the
  pass — and each slice carries its own projection, so one distance
  comparison is not even well-defined across them. Sol at 1 AU and a body
  at 1e-3 AU routinely land in different slices.
- **The local pass's attachment must stay `DEPTH_COMPONENT24`.** Its
  slice-ratio bound is derived from 24 bits, and `../../README.md`
  § Pass ordering warns that a depth *texture* of the wrong type
  coarsens every close-range z-test by 256× with no other symptom.
  Not touching that attachment removes the hazard entirely.
- **One coarse bracket is enough here.** The question is "is a surface
  nearer than this source?", never "which of these two surfaces is in
  front" — so this pass needs none of the precision the local pass's
  slicing exists to buy. `coverage-pure.test.ts` pins the reported
  Saturn-vs-Sol case at six orders of margin over one depth quantum.

The reduced resolution costs nothing the statistic cares about: it is a
frame-wide mean, and depth *values* are resolution-independent — only the
taps get coarser. Screen-space sizing in the mirror materials rides
`uViewport` in CSS px and resolves to an NDC extent, so a billboard
covers the same **fraction** of the smaller target and the taps stay
aligned with it.

**The occluder scene IS `LocalDepthPass.scene`**, re-rendered under the
one bracket, and the bracket comes from `localDepthPass.memberSpheres()`
— the same list that pass just partitioned. That is what makes the
measurement run against the geometry the frame actually drew rather than
a CPU mirror of it. Two consequences:

- **No members means no measurement.** An empty sphere list gives a null
  bracket, and every source keeps its full flux (§ Latency). Correct: a
  body only draws a surface while its cluster is active, so with no
  cluster there is nothing close enough to occlude anything.
- The colour attachment is a throwaway three requires. The mirror
  materials shade into it and the result is discarded; overriding them
  with a depth-only material is **not** available, because the billboard
  members build their own vertex positions in their vertex stage.

## Rings are translucent, and the shipped data says so

The strips carry `alpha = 1 − e^−τ` at each ring's **normal** optical
depth (`data/textures/README.md` § Ring strips), so
`τ = −ln(1 − alpha)` and a slant path of `1/|sin B|` normal depths gives

```
T = (1 − alpha)^(1/|sin B|)
```

for ring opening angle `B` — one `pow`, no logs. What the angle buys is
the thing a single opacity scalar cannot express: the **same** ring is
opaque edge-on and translucent face-on. Uranus's ε peaks at 167/255,
which passes 35% face-on and under 1e-5 at a 5° opening.

Two consequences worth stating, because they look like bugs otherwise:

- **Ring annuli write no depth** (`depthWrite: false`, in-pass
  renderOrder 2.81), so they never reach question 1 — they are handled
  only by question 2. That is correct: a binary z-test cannot express
  partial extinction, and every ring system in the app is partial.
  Saturn is the Jónsson radial reconstruction over 74,510–140,390 km, so
  the C ring, Cassini Division and Encke gap are genuinely translucent
  while the B ring is near-opaque.
- **The crossfade weight rides the alpha, not the geometry.**
  `RingOccluder.alphaScale` is the annulus's live `uFade`, so the
  extinction tracks the alpha actually composited — a ring half-way
  through its crossfade dims a source behind it half as much as the
  authored strip would. `PlanetMeshLayer.forEachRingOccluder` reports one
  slot per visible annulus, in view space, capped at
  `COVERAGE_MAX_RINGS`; the shader unrolls the slots because GLSL ES 3.0
  cannot index a sampler array by a loop variable.
- **This supersedes "rings never dim a body behind them."** That was the
  circle era's deliberate exclusion (rings are not *sources*, so they
  never entered the sample list) and it shipped in v3.7.0's release
  notes. Rings now extinguish by their authored optical depth.

## Composition — multiplicative, where the circle era subtracted

`visibleFraction(clipped, transmission)` multiplies. The old
`max(0, clipped − occluded)` subtracted because it did not know *where*
an occluder sat relative to the frame edge; measuring transmission over
the on-screen part of the disc makes the product exact — `clipped` is
what fraction of the disc is in frame, `transmission` the mean throughput
over exactly that part.

**Both terms must run over the SAME disc, and that is `visibilityDiscRadiusPx`.**
The clipping term is floored at `ADAPT_EDGE_RAMP_PX` across
(`../README.md` § Adaptation — a sub-pixel source's own 1.1 px footprint
would otherwise take its fraction 0 → 1 inside one frame of camera
jitter), so the taps carry the same floor: `tapRadiusPx` in the shader.
Give them different radii and the product stops being a fraction of one
region — a sub-pixel source sitting in the ramp band just off the frame
edge reads `clipped ≈ 0.25` with every tap out of frame, so it keeps all
its flux and its occlusion is never evaluated at all. The **self-occlusion
slack keeps the true footprint radius** (§ The slack): that one is the
source's own body, not the ramp.

Frame clipping stays on the CPU (`sourceVisibleFraction`): it is exact
analytic geometry with no scene dependence, so there is nothing for the
GPU to tell us.

## Latency, and what an unmeasured source reads as

The readback lands a frame late, which the statistic already tolerates:
the applied cut is slew-limited over `ADAPT_SLEW_TAU_S` (300 ms), so tens
of ms are far inside the ramp it feeds. Do not make it synchronous to
"fix" a lag nobody can see — `getBufferSubData` on an unsignalled fence
stalls the pipeline, which is the whole thing the fence exists to avoid.

**One readback in flight.** A frame whose predecessor has not landed does
no GPU work at all rather than queueing a second, so the measurement
refreshes every other frame at worst (~33 ms at 60 Hz). That also caps
the cost: the extra scene render happens on half the frames.

**The lag is why the result is keyed, not indexed.** The pool the walk
produced is gone by the time its measurement returns, so each sample
carries a `sourceKey` — bodies their flat instance index, stars
`-1 - starIdx`, disjoint by construction — and `CoveragePass` maps key →
throughput. Pool order would hand one source another's answer the moment
a body left the frame.

**Hardware without `EXT_color_buffer_float` gets no measurement at all**,
and therefore no occlusion — the whole pass declines to allocate. That is
the same fallback tier `HdrPipeline` parks on when it finds only
half-float, and it degrades to the pre-measurement behaviour rather than
to a wrong one.

**An unmeasured source reads as throughput 1**, and that direction is
deliberate: a source not yet covered keeps all its flux, so it can only
ever provoke a *cut*. The opposite default would let a frame go dark
because a measurement had not arrived — and under-occluding is also the
safe side of the defect this replaces, which was Sol blazing at full
brightness because the statistic had dropped it.

## Where it runs in the frame

`stellata.ts` `animate()`, after `localDepthPass.render` (its spheres set
the bracket, its scene supplies the occluders) and after `hdr.resolve`, so
the measurement never delays the frame it measured. It leaves the render
target at the canvas and restores `camera.near` / `camera.far`, the same
contract the local pass keeps.

Perf rows: `submit.coverage` (CPU submission) and, where the driver
exposes a timer query, `gpu.coverage` — `../../../debug/README.md`
§ GPU timing.
