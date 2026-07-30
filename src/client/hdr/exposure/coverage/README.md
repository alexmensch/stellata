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

- `coverage-pure.ts` (+ test) — the math both sides share: the
  perspective depth inverse and its forward mirror, the deterministic
  disc tap set, ring slant transmission, the single-bracket depth range,
  and the visible-fraction composition. Vitest-pinned against the
  reported Saturn-vs-Sol geometry and against the real ring strip values.

## The measurement

One fragment per source. Each takes `COVERAGE_TAPS` (64) equal-area taps
over that source's screen footprint, and each tap asks two questions:

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

## The depth bracket — a dedicated pass, deliberately

The occluders are rendered into **their own quarter-resolution target
with a single `[near, far]` bracket**, not sampled from the local depth
pass's attachment. Three reasons, each load-bearing:

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

Quarter resolution costs nothing the statistic cares about: it is a
frame-wide mean, and depth *values* are resolution-independent — only the
taps get coarser.

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
- **This supersedes "rings never dim a body behind them."** That was the
  circle era's deliberate exclusion (rings are not *sources*, so they
  never entered the sample list) and it shipped in v3.7.0's release
  notes. Rings now extinguish by their authored optical depth.

## Composition — multiplicative, where the circle era subtracted

`visibleFraction(clipped, transmission)` multiplies. The old
`max(0, clipped − occluded)` subtracted because it did not know *where*
an occluder sat relative to the frame edge; measuring transmission over
the on-screen part of the footprint makes the product exact — `clipped`
is what fraction of the footprint is in frame, `transmission` the mean
throughput over exactly that part.

Frame clipping stays on the CPU (`sourceVisibleFraction`): it is exact
analytic geometry with no scene dependence, so there is nothing for the
GPU to tell us.

## Latency

The readback lands one frame late, which the statistic already tolerates:
the applied cut is slew-limited over `ADAPT_SLEW_TAU_S` (300 ms), so a
16 ms lag is far inside the ramp it feeds. Do not make it synchronous to
"fix" a lag nobody can see — that trades a stall for nothing.
