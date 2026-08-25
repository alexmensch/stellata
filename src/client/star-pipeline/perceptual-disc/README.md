# Perceptual disc — how a point source is sized and shaped

The display kernel every point source in the scene renders through: the
`max(appSize, physSize)` sizing rule, the plate-scale calibration that
makes it viewport-invariant, and the super-Gaussian profile that shapes
it. Stars and planet glare share this kernel exactly.

## Files

- `perceptual-disc.glsl` — the shared GLSL chunk, registered as
  `stellata_perceptual_disc` in `../../stellata.ts` and `#include`d by
  `../star.vert.glsl`, `../star.frag.glsl` and
  `../../solar-system/planets/glare/planet.{vert,frag}.glsl`. The chunk
  name is what the includes name, so moving this file does not touch
  them.
- `perceptual-disc-pure.ts` + `perceptual-disc-flux-pure.ts` (+ tests) —
  the chunk's **one** CPU mirror (dmEff / appSizePx / exponent / profile
  + divisor guards) and the kernel's area integral `Φ(n)`. The pick path,
  planet body field, and the port's TSL graph compose over them rather
  than re-deriving.
- `perceptual-disc-uniforms.ts` — TypeScript shape for the uniforms the
  chunk consumes. `buildSharedUniforms` `satisfies` this interface, and
  `PlanetBodyField.buildMaterials` picks exactly these keys out via
  `pickPerceptualDiscUniforms`. Single source of truth so the two
  pipelines can't drift at the chunk's interface.

The WebGPU port's TSL mirror of the same kernel is
`../../webgpu/perceptual-disc-tsl.ts`, composed over the constants this
folder exports.

## Physical-size rendering

Each star's final pixel size is `max(appSize, physSize) × pixelRatio`
in the vertex shader (collapsed past the visibility floor — `../collapse/README.md`):

- `appSize` is the brightness-based term: the `√Δm` Gaussian-PSF curve
  over the visible-population window `Δm = uLimitMag − appMag`, with
  **soft-knee saturation** (`uSizeKnee`, default 16 mag, debug-tunable)
  above it. The curve and the knee's Michaelis–Menten form live in
  `perceptual-disc.glsl`'s header; the derivation is
  `docs/science-stellar-modelling.md` § Stellar perception model.
  `uSizeKnee = 0` recovers the hard clamp the knee replaced — which had
  pinned Sol and Barnard's Star to the same cap at 5e-3 pc despite a
  2300× flux ratio. Endpoints `uSizeMin/Max` are derived from the
  instrument's PSF and the live plate scale (§ Angular-size calibration
  below).
- `physSize = 2·atan(R · radiusFactor / dPc) · viewport.y / uFovYRad`
  is the star's true angular diameter projected to pixels. `R` is the
  per-star physical radius in pc (decoded from the `iLogRadius` vertex
  attribute via `pow(10, iLogRadius)`); `radiusFactor` is the
  variability modulation. Falls off as `1/d` in the small-angle
  regime; saturates as `d → R` (disc fills the frame). This drops
  every artificial reference-distance + log-mapped-pixel-range knob
  in favour of pure geometry, so the on-screen disc ratio between any
  two stars at equal `d/R` matches their physical radius ratio.

A **soft taper** runs in the fragment shader's glow pass, anchored on
`uThresholdMag` — the magnitude a source lands exactly on `L_THRESH` at,
instrument plus EV trim. Stars within +0.5 mag of it fade in glow
intensity via
`1 - smoothstep(uThresholdMag, uThresholdMag + 0.5, vAppMag)` so the
faint edge is always a fade rather than a pop. The disc pass hard-clips
at `uThresholdMag` (resolved discs in the fade region would render as a
sub-pixel speck and read as a hard cutoff anyway). The vertex cull sits
further out still, at `uCullMag`; the taper must never follow the cull
bound, or a threshold star would stop landing on the floor the unit is
anchored to (`../../hdr/exposure/README.md` § One writer, five slots).

## Angular-size calibration

The threshold and saturation discs are *angular* sizes on the sky, from
the instrument's PSF width (σ = `psfArcsec` = 30″ for the 7 mm
dark-adapted pupil) scaled by the exaggeration K — and K is derived from
the live plate scale rather than authored per instrument:

```
arcsec_per_px = fov_deg · 3600 / viewport_height_css_px
K = kDensity · kMultiplier · max(1, TARGET_PX · arcsec_per_px / psfArcsec)
```

so `sizeMinPx = σ·K / arcsec_per_px = TARGET_PX` (2.592 px) identically:
**star pixel size is invariant in FOV and in viewport size**, until K
floors at 1 and the true 30″ PSF resolves, past which the disc grows with
the plate scale. What zooming buys is *separation, not size* — a close
pair merged into one blob at 50° resolves at 10°, because the K inflating
both has shrunk. The blob was never physics.

`kDensity` is the instrument's own half of K — a crowding term, 1 for the
unaided eye, since a deeper limit needs a smaller footprint or a dense
field washes into a solid sheet. `kMultiplier` is the panel's "Star size
exaggeration" slider — the only user-facing footprint control, and
deliberately the only one (`../../filters/README.md` § The multiplier is the
ONLY footprint control).

The conversion divides by viewport **height** — the axis `camera.fov`
maps to, and the axis `Ω_px` and `physSize` already project through. The
old `max(w, h)` reference dimension is retired: it existed to stop stars
vanishing on landscape mobile, which a coarser plate scale now handles by
raising K on its own. Widening a desktop window therefore changes star
size by zero; it only reveals more sky.

The plumbing that calls it — `setInstrument`, `recomputeStarPxSizes`,
`setCameraFov`, and their override / resize semantics — belongs to
`../../filters/README.md`; this section is only the perception model those
knobs feed, and `docs/science-stellar-modelling.md` § Stellar perception
model carries the derivation.

`uFovYRad` (mirrored from `camera.fov` on every FOV change) is the only
viewport-derived shader uniform that drives
`physSize`. There is no per-pixel-range cap — a max-radius supergiant
at the orbit floor fills `ZOOM_FLOOR_FRACTION` (= 0.9) of the
viewport's minor axis purely because `minOrbitDistForStar` solves for
that distance. Smaller stars land closer to fill the same 90%; the
camera near plane (`1e-12`) gives several orders of magnitude of
headroom even for white dwarfs and Sirius B-class radii.

A varying `vPhysRatio = physSize / max(pxSize, 0.001)` is passed to
the fragment shader to drive the pass split (`../README.md` § Star
rendering) and the luminosity-class softness blending (below).

## Star intensity profile

Both the disc and glow passes share a single **super-Gaussian**
falloff shape (`perceptualDiscProfile` in `perceptual-disc.glsl`),
parameterised so the perceived bright disc fills the calibrated quad
to its edge. It is a **unit-peak kernel**: it shapes the light,
`vPeakL` scales it (`../README.md` § Physical-luminance emission).

The formula, the threshold subtraction that lands `glow = 0` exactly at
`r = 0.5`, and the two inputs that morph the exponent `n` — distance via
`vPhysRatio` (Gaussian-fuzzy when distant, plateau-with-edge when
resolving) and luminosity class via `vSoftness` — are derived in the
chunk's own header. Star-specific bindings: `vSoftness =
clamp(iLumClass / 9, 0, 1)` where `iLumClass` is 0=WD, 2=V, 4=III,
6–9=supergiant, 255=unknown → V. Physical radius already makes
supergiants render larger; the softness bias is what makes a same-size
WD and a Betelgeuse-like supergiant still read differently.

The disc pass adds two depth-handling rules on top of the shared
profile:

- **Halo transparency.** When `glow < uCoreThreshold`, the fragment
  paints its colour under the disc pass's `MaxEquation` blend (so the
  halo brightens the framebuffer per channel up to the halo's level)
  but writes `gl_FragDepth = 1.0` (far plane). The later glow pass's
  distant stars then pass the depth test and accumulate additively on
  top — the haze stays visible while background stars peek through.
  `MaxEquation`'s trade-off: faint halos against bright backgrounds
  wash out instead of summing, in exchange for no disc-edge artefacts
  in close binaries. The core mask handles the inverse problem
  (preventing MW/grid bleed through the bright core).
- **Discard fringe.** `glow < uDiscardThreshold` (default 0.02) drops
  the fragment entirely so the imperceptible outer pixels don't cost
  a depth write or no-op blend.

All eight knobs are live-tunable from the debug panel
(`debug.panel()`) under "Star disc": `visibleThreshold`,
`coreThreshold`, `discardThreshold`, `distN min/max`,
`lumBias dwarf/hypergiant`, `sizeKnee` (the soft-knee saturation
extent above). See `STAR_RENDER_DEFAULTS` in
`../../filters/filter-state.ts` for shipping values;
`setStarRenderParams(patch)` is the programmatic setter.
