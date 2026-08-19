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
  ring-photometry-pure.ts  The ring system's share of the body's
  (+ test)                 UNRESOLVED apparent magnitude: the joint
                           phase-angle / ring-tilt law. Pure,
                           vitest-pinned. § Ring photometry.
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

The annulus above is the *resolved* half. While the body is a billboard
its rings still carry most of its light, and that rides
`ring-photometry-pure.ts`: Mallama & Hilton 2018 Eq. 10 (the whole system,
`V₁(0) = −8.914`) differenced against the globe-alone Eq. 11/12 curve
`Planet.phaseCoefficients` holds, giving a **flux multiplier on φ(α)**.

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

**It is a per-frame per-instance attribute, `iRingBoost`, not a static
one** — β depends on where the camera is. `PlanetBodyField.update`
evaluates the law on the CPU and ships one float per body, the same shape
`iEclipseDim` takes; `evalPlanetView` recomputes it for the hover/pick
viewer. Nothing in `planet.vert.glsl` knows the law, only that φ gets
multiplied.

### Three places the published fit runs out, and what happens instead

- **α > 6.5°.** The paper states outright that there is not enough
  information to extend the system magnitude past it. The ring term
  becomes anchor-scaled Lambert from its 6.5° value — the same
  convention `../../phase-function.ts` uses past a globe polynomial's
  bound. The law's α slope is the ring opposition surge and is spent by
  ~2°, so nothing measured is being discarded.
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

Below β ≈ 0.94° the term floors at zero. `globeZeroPointDelta` = 0.036
mag separates two independently determined zero points (2012 photometry
vs 2017 synthetic spectrophotometry) and would otherwise make a
near-edge-on system marginally fainter than its own bare globe — inside
the mutual uncertainty of the two, so a calibration offset to floor
rather than an edge-on occultation to model.

**The cull reads the term's MAXIMUM** (`maxRingSystemFluxFactor`, α = 0
at β = 27°, ≈ 2.43×), which widens Saturn's `cullDistancePc` by ≈ 1.56×.
A per-frame value there would drop a Saturn parked near a ring-plane
crossing at a distance it becomes visible from once the rings open.

**Uranus and Neptune ship strips but no photometry.** Their rings are
true-opacity charcoal threads, and the brightness-vs-inclination Mallama
publishes for Uranus is polar methane depletion — not a ring term.

**Not modelled: the annulus's own opposition surge.** The α dependence
above reaches the billboard only. A parked Saturn's drawn strip has no
phase term (§ the annulus lighting model above), so the resolved regime
still makes no photometric claim about the surge Fig. 3 of the paper
shows — `stellata-2f6.60`.
