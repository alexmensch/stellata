# Eclipse photometry

`EclipsePhotometryField` — the per-frame geometric-occlusion dim on a
binary's back component. Depends one-directionally on the shared loader
and relation cache in `../`; nothing in `../` imports this folder.

## Files in this area

```
src/client/binaries/eclipse/
  eclipse-photometry.ts (+ test)  Per-frame field over the shared relation
                                  caches. Evaluates each pair's offset in
                                  float64 and writes per-instance
                                  iEclipseDim for the back component when
                                  discs overlap. Runs AFTER
                                  ../binary-orbit-field.ts each frame.
  eclipse-photometry-pure.ts      Pure camera-anywhere occlusion math:
    (+ test)                      eclipseDimFromOffsets (closed-form
                                  circle-circle lens area),
                                  orbitPlaneNormalICRS (the view-direction
                                  prefilter's normal), and the shared
                                  anti-strobe helpers dimBlendFactor /
                                  blendDimBuffer / DIM_SETTLED. The test
                                  pins the degenerate cases and the
                                  float32-line-of-sight immunity.
```

Two further consumers of the pure half. The planet field's true-eclipse
dim (`../../solar-system/planets/eclipses/README.md` § True-eclipse dim) reuses all
of it for planet-behind-host-disc occlusion; the exposure-adaptation
statistic (`../../hdr/exposure/README.md` § Adaptation) takes
`circleCircleLensArea` alone, in **screen pixels** rather than angular
units, for its nearer-disc occlusion pass, plus `dimBlendFactor` for the
slew limit on the applied exposure cut — the same "smooth a per-frame
geometric measurement, in real seconds, snapping the first frame"
problem this folder's anti-strobe pass solves.

`EclipsePhotometryField` runs after `BinaryOrbitField` each frame
and writes a per-instance dim multiplier on the back component's
flux whenever discs overlap from the camera's viewpoint. The math
is camera-anywhere by construction — EA/EB/EW labels are Earth's-
viewpoint facts; any system can eclipse from any viewpoint when its
geometry aligns. Each pair's offset is evaluated per frame in
**float64** as `baseDiffPc + ΔR(t) = R(t)` (the elements-alone epoch
baseline plus the orbital delta — exactly the offset the position walk
renders: the barycentric split and hierarchical anchor both preserve
`sCoeff − pCoeff = 1`). The pure helper decomposes that
offset against the camera→primary line of sight, computes each
disc's angular radius, and runs the closed-form circle-circle lens
area; the dim is `1 − occluded_area / back_disc_area`.

**Never derive pair geometry from `localPositions`** — the float32
position quantum is `d_origin · 2⁻²³` (≈0.6 AU for a star 25 pc from
the local origin), larger than most orbital separations, so a
subtraction of two buffer positions reads pure grid noise where the
eclipse test needs nano-radian resolution. The buffer is only read
for the line of sight, whose float32 error cancels between the two
unit view vectors.

The Kepler eval here is deliberately NOT gated on the orbit walk's
screen-pixel LOD: the photometric dip is exactly the signal that
remains when the pair is sub-pixel. Instead each relation carries a
**view-direction prefilter** — the rendered offset always lies in
the orbit plane, so lines of sight steeper against that plane than
`(r_pri + r_sec) / min_separation` can never bring the discs into
overlap and skip the Kepler solve (the vast majority of (camera,
pair) combinations each frame). The minimum separation is closed-form
periapsis `a(1−e)` — the rendered offset is `R(t)` exactly, no
sampling.

Surface-brightness ratios stay implicit: each star is its own
instance with its own absmag, and dimming the back's flux by the
geometric area fraction gives the right composite when the two
sum additively in the glow pass. Limb darkening is not modelled
(uniform disc surface brightness).

#### Anti-strobe smoothing

Under heavy time-warp an eclipse can last less than a frame; raw
per-frame geometry would strobe the composite at frame rate. Written
dims blend toward each frame's geometric target with time constant
`ECLIPSE_DIM_TAU_S` (real seconds — a render filter, not sim time),
so sub-frame events read as a soft shimmer while real-time dips
(hours long) pass through visually untouched. Slots decay back to
exactly 1.0 after occlusion ends and leave the field's active set;
frames that write nothing skip the attribute re-upload entirely.

#### What the render cadence reads

`cadenceReport(simDtS)` is this field's declaration to the render gate
(`../../render-gate/cadence/README.md`), and it is photometric only — the
members' on-screen motion is `../binary-orbit-field.ts`'s to report, and
this field deliberately shares none of its screen-pixel LOD.

A dip's slope is `targets` differenced against `prevTargets` over the
elapsed sim time; the two maps ping-pong at the top of `update`, so the
pair costs no allocation. Exact, zero through totality on its own, and no
model of stellar radii or shadow speeds — the planet field's dims use the
same mechanism.

Two contracts worth stating:

- **A dip that ENDED this frame is still counted**, by walking the
  previous frame's targets for keys this frame's map lacks. Missing them
  would leave the recovery back to full brightness unbudgeted.
- **The magnitude gate against the LIVE threshold is what keeps an
  invisible eclipse from setting the frame rate.** Each Galilean is
  eclipsed 2–4 h per orbit, ~12 % duty for the four, all under the
  default view's cut; counting those held the frame rate through every
  invisible eclipse in the model, which is how the first attempt's idle
  win came to depend on nothing happening to be in shadow.

A dip's FIRST frame differences 1 against 1 and reports nothing — onset
is what the 30 s cap is for.

#### Shader-side wiring

`iEclipseDim` is folded into appMag in the **glow pass only**
(`uRenderMode == 0`) — applying the dim in the disc pass would also
dim the back disc's non-occluded fragments. The integration shell
initialises the buffer to 1.0 at allocation and on every re-attach.

A resolved pair's overlapping disc cores order **geometrically in the
local depth pass**: both members mirror into the bracketed pass
(chain membership — `star-pipeline/local-pass/README.md`), whose
standard-depth bracket resolves the pair's sub-AU
line-of-sight separation natively. The main pass never has to order
them — the retired `iDepthBias` mechanism did that with a per-frame
float64 front/back nudge before the pass existed.

`eclipse-photometry-pure` floors PARTIAL dims at `DIM_FLOOR = 0.001`
(a numeric-domain guard so `-2.5·log10(dim)` stays finite as overlap
approaches totality) but returns **exactly 0 for a full geometric
eclipse**, and both glow shaders collapse the quad at 0 (the star
pipeline's off-screen-sentinel pattern). A floored +7.5 mag residual
is invisible for typical binary flux levels but NOT for a bright
close-range back body — Mercury (mag ≈ −1) behind Sol's disc stayed a
visible glow point — and the depth buffer can't hide it either (the
pair's line-of-sight separation sits inside one log-depth bucket).
`blendDimBuffer` snaps a decaying totality slot to exact 0 once it
drops below the floor, since the exponential smoothing alone never
reaches the shader's `<= 0` gate.

The pick path mirrors both halves — the totality collapse and the
partial dim's magnitude penalty — in
`../../camera/controls/star-pick-visibility-pure.ts`, and mirrors them
**glow-pass only**, matching the `uRenderMode == 0` gate above. Applying
the dim to a disc-dominant star would hide one that is plainly on
screen: its disc keeps drawing and the local depth pass orders the pair.

The penalty lands on the pick's **radius** as well as its visibility: the
shader folds the dim into `appMag` before deriving `pxSize`, so a dimmed
glow quad is smaller as well as fainter, and a pick that kept the
undimmed radius would accept clicks outside the drawn footprint.

#### Pulsation gate for eclipsing binaries

`iSuppressPulsation` is a per-instance flag built once at
catalog-load time from `catalog.varType` alone: 1.0 on every
record whose GCVS variability type is `VAR_TYPE_ECLIPSING`,
independent of the binaries data. Eclipsers are extrinsically
variable — the brightness dip is a line-of-sight occlusion, not
the star's own output — so the GCVS-amplitude radial pulsation is
always a fabrication and is gated off unconditionally.

For an EA/EB/EW primary WITH orbital elements, the honest signal
comes from `EclipsePhotometryField`'s geometric dip. For one with
NO elements (no NSS or ORB6 entry) there is no phase to animate, so
the star simply renders static — we don't invent a pulsation cycle
we can't derive.

`star-physics.ts`'s `renderedSizePx` reads the same suppress mask
(via the optional `suppressPulsation` arg) so the SVG focus ring +
distance-vector tip track the rendered (un-modulated)
disc on suppressed primaries.
