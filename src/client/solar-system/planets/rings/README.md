# Ring systems — annulus shaders and the radial strip

Saturn, plus Uranus + Neptune's faint rings at true opacity. `../README.md`
owns the mesh-LOD regime these render inside; the strip data pipeline is
`data/textures/README.md` § Ring strips, which also carries the spans and
the Jupiter exclusion.

```
src/client/solar-system/planets/rings/
  planet-rings.vert.glsl,
  planet-rings.frag.glsl   Ring-annulus shaders (radial strip sample,
                           lit/transmitted faces, body shadow). Built and
                           driven by ../planet-mesh-layer.ts.
  ring-photometry-pure.ts  The joint phase-angle / ring-tilt law: the
  (+ test)                 ring system's share of the body's unresolved
                           magnitude, and the drawn annulus's phase
                           scalar. Pure, vitest-pinned.
                           § Ring photometry.
```

`Planet.rings` adds an annulus mesh in the body's equatorial plane (IAU
pole; host orbital plane as the no-elements fallback), textured by the
`<body>-rings.png` 1-D radial strip (RGB colour, A opacity; U =
inner→outer edge). Lit face gets full strip colour, unlit face a dimmer
transmitted factor, both fading out as illumination goes edge-on; the
far-side segment inside the body's shadow (analytic ray–ellipsoid test
toward the host) drops to a residual floor. Rendered only in the mesh-LOD
regime: alpha rides the same crossfade `uFade`, hidden until the strip
texture arrives (no representative-colour fallback), `renderOrder` 2.81
(after the body mesh) with `depthWrite: false`.

**The strip RGB is not sRGB-decoded**, which is the one thing about these
shaders that looks like a bug and isn't — `../emission/README.md`
§ Colour bookkeeping carries why.

**Body occlusion is the local depth pass's z-buffer**: meshes + annuli
render in the bracketed second pass (`../../../local-depth/README.md`),
where standard depth orders ring↔body natively — including the oblate
limb. The analytic ray–ellipsoid helper survives only for the body-shadow
term (sun ray, not camera ray). Geometry drawn near a planet body in the
MAIN pass still cannot depth-test against it (same README, § Why the main
pass cannot do this) — new close-range geometry belongs in the local pass,
not behind a new analytic trick. Edge-on the zero-thickness annulus thins
to a line, which is the physically honest look.

**The annulus is part of the subject the exposure pin exposes for**: it
claims lit-surface coverage over the strip it actually illuminates, and the
one blend equation scales that by the same strip opacity it scales the flux
by, so the ratio the pin reads comes out alpha-invariant
(`../../../hdr/attachments/README.md` § The unit). A parked Saturn is
therefore exposed for globe and rings together, area-weighted, rather than
for whichever is brighter.

**`lit` is the mask's gate and the flux's shadow term at once**, which is
why the shadow test and the edge-on fade are factored out of `light`: the
band inside the planet's shadow sits at `SHADOW_FLOOR` and the whole annulus
goes dark as the sun crosses the ring plane. Either counted as coverage is a
dark vote — and the annulus runs ~3.6x the globe's own disc area face-on, so
it outweighs every other coverage term the frame has. The **transmitted face
still counts**: `TRANSMIT` dims real illumination rather than removing it,
the same way the mesh keeps its grazing-incidence limb.

**Rings do dim a source behind them in the exposure statistic** — no
z-test could, they write no depth. The annulus composites over its
statistic texel like any other alpha-blended emitter, at the strip's
**face-on** opacity: a rasterised fragment carries no opening angle, so
the slant-path enhancement the source walk applied analytically
(`T = (1 − α)^(1/|sin B|)`, opaque edge-on) is gone
(`../../../hdr/attachments/README.md` § Known residuals).

**"Behind them" includes the Milky Way band and the Local Group**, which is
why the annulus is a `markOccludingEmitter` and writes `stellataOccluderTexel`
at that same alpha: the diffuse emitters live in their own attachment until the
resolve convolves them, and a draw that dims only attachment 0 lets the band
back in over a shadowed ring section (`../../../hdr/summation/README.md`
§ Everything that dims the field).

## Ring photometry — the unresolved magnitude

Both halves — the billboard's magnitude and the drawn annulus's
brightness — run one law from `ring-photometry-pure.ts`: Mallama & Hilton
2018 Eq. 10 (the whole system, `V₁(0) = −8.914`) differenced against the
globe-alone Eq. 11/12 curve `Planet.phaseCoefficients` holds. That
difference is the **ring flux, in units of the globe's own flux at
α = 0** — the same unit `empiricalPhaseFactor` reports the globe in, so
the system's φ(α) is simply the two added.

```
ΔV(α, β) = −1.825·sin β + 0.026·α − 0.378·sin β·e^(−2.25·α)
```

β is the effective ring inclination: the geometric mean `√(β_v·β_h)` of
the viewer's and the host's planetocentric latitudes, each the elevation
of that leg above the ring plane about the **same pole the annulus is
posed on** (IAU elements, host orbital plane as fallback) — so the drawn
annulus and the point-source magnitude cannot disagree about where the
ring plane is or which face is lit. Saturn swings **0.96 mag** from a
ring-plane crossing to rings wide open at opposition, a factor of 2.43;
before this the whole term was a static `c0 = −0.55` at β = 16°, the
long-run mean, which also left the resolved globe ~1.66× over-bright
(the mesh's `uPhaseScale` reads the same curve, and the annulus was
already being drawn on top).

**It is a per-frame per-instance attribute, `iRingFlux`, not a static
one** — β depends on where the camera is. `PlanetBodyField.update`
evaluates the law on the CPU and ships one float per body, the same shape
`iEclipseDim` takes; `evalPlanetView` recomputes it for the hover/pick
viewer. Nothing in `planet.vert.glsl` knows the law, only that the float
**adds** to φ. It adds rather than scaling for a numerical reason as much
as a physical one: as α → 180° the globe's flux and the rings' both
vanish, and a multiplier would be 0/0 there.

### Three places the published fit runs out, and what happens instead

- **α > 6.5°.** The paper states outright that there is not enough
  information to extend the system magnitude past it. The ring **flux**
  becomes anchor-scaled Lambert from its 6.5° value — the same
  convention `../../phase-function.ts` uses past a globe polynomial's
  bound. It has to be the flux and not the ring/globe *ratio*: extending
  the ratio compounds Lambert with the globe's own curve and buries the
  rings, 3.4× too faint by α = 90° and 23× by 150°. The law's α slope is
  the ring opposition surge and is spent by ~2°, so nothing measured is
  being discarded.
- **β > 27°.** A camera over Saturn's pole reaches β ≈ 49°, far outside
  anything an Earth-bound fit saw. Held at the 27° value: a stated
  clamp, not a silent extrapolation.
- **Backlit — the host and the viewer on opposite faces.** Out of
  domain, not merely unfitted: from Earth β_v and β_h never differ in
  sign, and Mallama's own rule is β = 0, no ring term at all. Stellata's
  camera reaches this routinely, so the term survives scaled by
  `RING_BACKLIT_TRANSMIT` — **the same `TRANSMIT` constant the annulus
  shader above dims its unlit face by**, test-pinned against the GLSL
  source. That shared fraction is what makes resolved and unresolved
  agree that crossing the ring plane dims the rings.

**The ring flux floors at zero**, which two separate things reach for.
Below β ≈ 0.94° `globeZeroPointDelta` = 0.036 mag — the gap between two
independently determined zero points (2012 photometry vs 2017 synthetic
spectrophotometry) — swamps the tilt term and would leave the rings
emitting negative flux; that is inside the mutual uncertainty of the two,
so it is a calibration offset to floor rather than an edge-on
occultation to model. Separately, at small β the 0.026 mag/deg α slope
outruns the tilt term within the fitted α range (by α ≈ 6.5° at
β ≈ 4.5°), because the slope was fitted where the rings dominate the
system and is not constrained near edge-on. Rings that near the plane
contribute little either way.

**The cull reads the term's MAXIMUM** (`maxRingSystemFluxFactor`, α = 0
at β = 27°, ≈ 2.43×), which widens Saturn's `cullDistancePc` by ≈ 1.56×.
A per-frame value there would drop a Saturn parked near a ring-plane
crossing at a distance it becomes visible from once the rings open.

**Uranus and Neptune ship strips but no photometry.** Their rings are
true-opacity charcoal threads, and the brightness-vs-inclination Mallama
publishes for Uranus is polar methane depletion — not a ring term.

### The drawn annulus rides the same curve

`uRingPhaseScale` is the ring flux at α over the ring flux at
opposition, so **1 at α = 0** — which is the anchor the strip already
carries: its RGB is pinned to a ~0.05 particle **geometric** albedo
(`data/textures/README.md` § Ring strips), and geometric albedo is by
definition the zero-phase value. Without the scalar the strip renders its
opposition brightness at every phase angle.

Driving it from the same law as `iRingFlux`, rather than from a ring
phase curve fitted independently, is what keeps the resolvedness band
stepless: inside that band the billboard and the annulus both draw, and
a surge on one alone would step the handoff. The backlit factor cancels
out of the quotient — `planet-rings.frag.glsl` owns that split itself
through `TRANSMIT`.

**It scales `light`, never `lit`.** `lit` gates the coverage mask as well
as carrying the shadow term, so folding the phase factor in there would
let the opposition surge vote on how much lit ring surface the exposure
pin divides its masked mean by — brightness masquerading as area. Pinned.

**Cassini corroborates the width, independently.** Déau et al. 2013
(Cassini/ISS) measure the surge half-width at 0.20° in the A and B rings
and 0.26–0.28° in the C ring and the Cassini Division. Eq. 10's own
`exp(−2.25·α)` half-falls at `ln2/2.25` = 0.308°. An Earth-based
disc-integrated fit and a spacecraft's resolved scans describe one
feature at one width, which is why the annulus needs no second
parametrisation.

**The surge is strip-averaged, deliberately — a per-radius one is not
derivable.** Déau's per-region amplitudes are 1.25 (B), 1.39 (A), 1.45
(C) and 1.47 (Cassini Division): the two regions furthest from the B
ring's value are also the faintest, so flux-weighting collapses the
spread to a few percent, and matching the disc-integrated law would then
need a build-time flux normalisation over the strip to avoid stepping
the handoff. The large per-region spread is in the linear regime's slope
(0.030–0.105 ̟₀P/deg, 3.5×), but that is an *absolute* slope of ̟₀P and
the per-region ̟₀P needed to turn it into a relative steepness is
published only in figures. The obvious cheap proxy — key the surge on
the strip's own opacity channel — is ruled out by the paper's own
result: amplitude correlates with optical depth *positively* below
τ ≈ 0.5 and *negatively* above τ ≈ 1, a turnover reported as
per-region correlation coefficients, not as a fitted τ → A law.

**Still not modelled: the grazing-illumination term.** The annulus takes
the host's irradiance with no solar-elevation factor — `lit` gates on
`smoothstep(0, 0.02, |sunDir.z|)`, a switch fully open above 1.15° of
elevation, not a falloff. An optically thick layer's radiance goes as
`μ₀/(μ+μ₀)`, so at grazing solar incidence the strip should dim toward
`sin β_S`. The billboard's `−1.825·sin β` carries exactly that, so
annulus and billboard still disagree on β the way they used to on α —
and β swings over the whole 29.5-yr cycle rather than a knife-edge
0.3°, so it is the larger of the two errors. `stellata-2f6.61`.
