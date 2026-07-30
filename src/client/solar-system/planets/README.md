# Planet rendering

The two render layers for planet and moon bodies, their shaders, IAU
rotation elements, inter-body shadow math, and per-body labels. The
system contract these read (`Planet`, `PlanetSystem`, `SOL_BODIES`) and
the reflected-light magnitude model live in `../README.md`; atmospheric
airlight is spliced in from `../atmosphere/`.

## Files in this area

```
src/client/solar-system/planets/
  planet-body-field.ts (+ test)   Instanced planet-body renderer. One
                                  additive reflected-glare pass (+ its
                                  local-pass mirror); the resolved surface
                                  is the spheroid mesh (planet-mesh-layer).
                                  Shares the glow half of perceptual-disc.glsl
                                  with stars — see
                                  ../../star-pipeline/README.md.
                                  isCollapsedOntoParent is the per-body
                                  "renders as one point with its parent"
                                  verdict (drawn this frame AND within
                                  BODY_COLLAPSE_THRESHOLD_PX of host /
                                  parent planet — looser than the binary
                                  1.5 px gate; body dots have multi-px
                                  glow footprints); pick() drops
                                  collapsed bodies so the parent's pick
                                  surface owns the point.
                                  forEachDrawnBody feeds the exposure-
                                  adaptation statistic (true angular size
                                  and flux, never the glare kernel —
                                  ../../hdr/exposure/README.md).
                                  Also the identity table for Target
                                  {kind:'planet'}: flat instance index ↔
                                  (host, planet-within-host), plus local/
                                  absolute position, appMag, and rendered-
                                  size accessors keyed on the flat index.
                                  uHideIdx (one uniform shared by both
                                  glare passes) hides the observe-anchor
                                  body via setHiddenInstance.
  planet-mesh-layer.ts            Close-range spheroid mesh LOD — see
                                  § Planet mesh LOD. Owns the shared
                                  atmosphere uniform block
                                  (sharedAtmoUniforms).
  mesh-crossfade.ts (+ test)      Disc ↔ mesh crossfade band math, pure
                                  (shared shader/CPU contract).
  mesh-surface-pure.ts (+ test)   Emission into the HDR unit: the limb
                                  constants the mesh shader mirrors, the
                                  disc-mean normalisers, and the two
                                  per-body luminance scalars. See
                                  § Physical-luminance emission.
  map-mean-luminance.ts (+ test)  Sphere-weighted mean linear luminance of
                                  a day map, measured once on load — the
                                  normaliser that reduces a stretched
                                  mosaic to an albedo pattern.
  rotation/                       Pole + prime-meridian elements and the
                                  texture-UV orientation chain — its own
                                  README (§ Planet rotation).
  body-shadow-pure.ts (+ test)    Soft-penumbra ray–sphere shadow math —
                                  CPU mirror of the mesh shader's caster
                                  loop, plus Io-transit / lunar-eclipse
                                  search tests on the real ephemeris.
  planet-labels.ts (+ test)       Per-body (planet + moon) SVG labels,
                                  resolvability-gated. See § Labels.
  planet.vert.glsl,
  planet.frag.glsl                Instanced reflected-glare billboards
                                  (point↔bloom on resolvedness, phase-
                                  gated + photocentre-shifted). Imports
                                  perceptual-disc.glsl from
                                  ../../star-pipeline/ (shared glow
                                  profile with stars).
  planet-mesh.vert.glsl,
  planet-mesh.frag.glsl           Lit spheroid shaders (equirect sample,
                                  host-direction Lambert terminator,
                                  representative-colour + limb-darkening
                                  fallback, atmosphere airlight over the disc).
  planet-rings.vert.glsl,
  planet-rings.frag.glsl          Ring-annulus shaders (radial strip
                                  sample, lit/transmitted faces, body
                                  shadow) — see § Ring systems.
```

## The two layers

- **`planet-body-field.ts`** — global, instanced mesh holding every
  attached host's planet bodies. Sol attaches once at startup; bk5
  will iterate exoplanet hosts in. Bodies are physical objects:
  they render whenever attached, regardless of which host the camera
  is focused on. Each frame, for each host:

  1. Skip the work entirely if the camera is past the host's
     `cullDistancePc` — the closed-form distance at which its
     brightest planet would just cross the population cull bound
     (`../README.md` § Per-host distance cull).
  2. Otherwise call `positionsAt(t, scratch)` to refresh local-frame
     positions, apply the per-host orientation quaternion, and write
     into the host's iLocalRel slot in the global instance buffer.

  The ephemeris walk runs whenever a host is in range **regardless of
  render visibility** — chart-mono and `setHidden` gate only the draw
  and the GPU upload, never the position update. Chart mode is
  observe-only and can observe from a planet, so the observe anchor and
  the focal-frame ride read the live `iLocalRel` positions off this
  walk even while the bodies aren't drawn; freezing the walk there
  strands the observer's orbital motion (Sol + planets appear static
  while catalog stars still advance).

- **`planet-mesh-layer.ts`** — the close-range spheroid mesh, ring
  annuli, and atmosphere shells. Only present in the mesh-LOD regime
  (§ Planet mesh LOD).

The orbit-ring layer is a sibling concern and lives in
`../ephemerides/orbit-rings-layer.ts` — it reads live centres from
`PlanetBodyField.getHostLocalPositionInto`.

## Position precision — float64 master, float32 GPU bake

`PlanetBodyField.localRel64` is the **master** host-relative position
buffer; `bufs.localRel` is its float32 bake, and exists only to feed the
`iLocalRel` GPU attribute. Every CPU consumer —
`planetLocalPositionInto`, `planetAbsolutePositionInto`,
`planetHostRelPositionInto`, `getHostLocalPositions`, `evalPlanetView`,
the eclipse-dim walk — reads the float64 master. `PlanetSystem.positionsAt`
writes a `Float64Array` for the same reason; moons compose
`parent_ecliptic + moonOffsetEcliptic` through the same buffer and
inherit it.

**Why it has to be float64.** A float32 parsec at 39.5 AU quantises to
**449 km**. Neptune and Pluto sit in the same float32 binade, so their
absolute step is identical — what differs is the body: 449 km is 1.8 % of
Neptune's radius and **38 % of Pluto's**. The CPU path feeds the mesh
LOD, the focus path, the moving-focal ride, and the overlay projections,
so the whole close-range chain inherited the quantum and Pluto visibly
stepped along its own orbit ring — the ring being smooth (float64 master
verts, `../../util/orbit-line.ts`) is what made the stepping legible.
That is the same split `StarFrame` uses: float64 recentre math, float32
write-back.

**The GPU attribute keeps the 449 km quantum, deliberately.** `iLocalRel`
drives the reflected-glare billboard only. The resolved surface is the
spheroid mesh, positioned from the float64 master via
`planetLocalPositionInto` — so at any zoom where a step would be visible
the mesh owns the pixels, and at billboard-dominant distances 449 km is
far below one pixel. Widening the attribute would double the per-frame
upload for nothing.

`planet-body-field.test.ts` pins the CPU path against a
deliberately-not-float32-representable Pluto-distance value; narrowing
any link back to `Float32Array` fails CI.

Bodies render as the spheroid mesh (resolved surface) plus **one
additive reflected-glare billboard** — no opaque disc / core-mask
pass. Apparent magnitude is computed in the vertex shader from
reflected host-star light through a per-planet phase function. The
visibility cutoff applies **to the glare** — sub-cutoff planets fade
naturally, no unconditional pixel floor — and never to the mesh
(§ Planet mesh LOD). The glare is one pass (main-pass draw +
**local-pass mirror draw** over the active cluster's slot range, gated
by the shared `uLocalPassRange` uniform — opposite sense under the
`LOCAL_DEPTH_PASS` define). While the system is locally active
(`../local-cluster.ts`) the main-pass instances collapse and every body
renders through the mirror in the bracketed local depth pass, where the
**mesh** writes depth so the additive glare is occluded to a lit-limb
halo and the z-buffer natively orders ring↔body, moon↔planet,
transits, and near-side orbit-ring arcs (`../../local-depth/README.md`).
Distant, not-locally-active bodies draw in the main pass as a faint
additive point that needs no depth occlusion (like a star).

## True-eclipse dim

A planet crossing behind its host's *physical disc* (superior
conjunction inside the host's angular radius) dims by the occluded area
fraction — the same camera-anywhere geometry the binaries eclipse
photometry runs (`../../binaries/eclipse-photometry-pure.ts`:
`eclipseDimFromOffsets` + the shared anti-strobe blend helpers).
`PlanetBodyField.update` evaluates each in-range host's planets per
frame (the pair-relative offset is `iLocalRel` itself — small values, no
large-position differencing) and writes the per-instance `iEclipseDim`
attribute.

A moon composes a second, multiplicative dim: the same lens math from
the MOON's viewpoint with the parent planet as occluder of the host
disc — the visible host fraction IS the moon's illumination, so a
lunar-style eclipse darkens the moon continuously through the
penumbra (search-tested against a year of real ephemeris);
the vertex shader applies it as a flux multiplier on the glare
intensity in both regimes — not an appMag fold, because the
locally-active photographic regime derives brightness from surface
radiance rather than appMag. A FULL eclipse
writes exactly 0 and the shader collapses the quad — a floored +7.5
mag residual is still visible on a mag −1 Mercury, and the planet-
scale depth buffer can't hide it — and the planet's label hides with
it (the fully eclipsed body renders nothing). Glare through the host's
perceptual *halo* stays undimmed — the halo is a perceptual
artefact, not a surface, so a body behind it correctly shines
through. A planet in *front* (transit) dims the
host by (R_p/R_host)² — negligible and owned by the star pipeline,
so it is deliberately not modelled.

## Physical-luminance emission

Both planet layers emit into the scene-wide HDR unit
(`../../hdr/README.md` § Unit) — the glare through the point-source rule,
the mesh through the surface-brightness rule. There is no per-layer
brightness encoding left: `uExposure` is the one exposure, and
`uGlareGain` is a debug multiplier rather than a calibration knob.

**The mesh anchor is a closed form.** A body's mean disc surface
brightness drops both its radius and the viewer distance, because they
cancel in `m + 2.5·log10(Ω_disc)`:

```
S₀ = m_host@body + 2.5·log10( π / (ARCSEC_TO_RAD² · p) )
```

so surface brightness depends only on host irradiance and geometric
albedo — which is why a body does not brighten per-pixel on approach, the
failure the old `^0.25` display compression existed to hide. The
full-Moon case lands on +3.4 mag/arcsec², the measured value, from the
same `p` that anchors the −12.7 flux; both are vitest-pinned.

**Phase is carried once, by the shading.** `S₀` deliberately excludes
φ(α): the shader's own Lambert terminator integrates to φ_Lambert on its
own, and `uPhaseScale` corrects that to the body's measured Mallama
curve. Folding φ into the anchor as well would count it twice.

**Two disc means divide out**, which is what makes everything the shader
multiplies on top a pure redistribution rather than a dimming:

- `lambertLimbDiscMean` — the closed form `2·(F/3 + (1−F)/(3+E))` for
  Lambert × limb darkening. The Lambert term contributes the 2/3 that
  reconciles mean radiance with the geometric-albedo convention
  `planetApparentMagnitude` uses; limb darkening then redistributes at
  unit mean. Atmospheric bodies substitute `F = 1` (no limb term — the
  scattering governs their limb), recovering the pure 2/3.
  **`LIMB_FLOOR` / `LIMB_EXP` are mirrored as literals in
  `planet-mesh.frag.glsl`** and drift-pinned; changing one side alone
  shifts every body off its flux with no other symptom.
- The **day map's own mean linear luminance** (`map-mean-luminance.ts`),
  measured once on load from a downscaled copy, cos-latitude weighted.
  The maps are brightness-stretched mosaics whose absolute level is not
  radiometric — the build calibrates their mean *chromaticity* and
  preserves whatever mean luminance the source had
  (`data/textures/README.md` § Colour fidelity) — so the map may supply
  only the pattern and the level has to come from `p`. Texture-less
  bodies use the representative colour's own luminance, which is exactly
  what that branch emits, so it is exact. Dividing by the measured mean
  also makes the texture arriving mid-approach **flux-neutral**: both
  branches target the same disc integral, so the map fades in as pattern
  without a brightness step.

**The resolve step is continuous by construction.** Past 1 px the glare's
point-source rule emits `L(m)/(π·r_phys²)` — the disc's mean surface
brightness — and the mesh emits that same quantity from the same `p` and
irradiance. `mesh-surface-pure.test.ts` pins the two against each other
to 1e-12 relative. This is what retired the old resolve-step luminosity
step, where a dim-surfaced body's compressed mesh could read dimmer than
its own peak-1 glare and a bright moon could outshine a resolved parent:
that step existed only because mesh and glare were on unrelated scales.

**Colour bookkeeping.** Day maps still load `NoColorSpace` and the mesh
shader decodes them with `stellataSrgbDecode` before lighting — a raw
display-encoded texel multiplied by a physical luminance would light the
body with a gamma-bent albedo. `Planet.colour` is already linear and is
not decoded. Ring strips are **not** decoded: their RGB was authored as a
linear reflectance proxy anchored to the ~0.05 particle albedo, so
decoding would darken the rings ~5x against the true-opacity alpha they
were built with. That leaves the strip the one hand-anchored reflectance
in these layers.

**Both render paths.** Each planet shader applies the operator inline
when `uHdrTarget` is 0, undithered — the mesh, ring annulus and
atmosphere shell composite over each other, so a fragCoord-keyed dither
would bias a pixel once per layer (`../../hdr/README.md` § Operator). The
shell runs the operator on its airlight *before* `uFade` premultiplies,
since the crossfade is a compositing weight, not light.

## Planet mesh LOD

On close approach the reflected glare hands off to a real oblate
spheroid mesh (`planet-mesh-layer.ts`). Mesh presence and the glare's
point↔bloom regime ride **one** physical-pixel resolvedness band
(`mesh-crossfade.ts`), so the two morph in lockstep — there is no
separate billboard fade band and no opaque disc / core-mask to
crossfade.

- **Mesh presence** rides the body's TRUE projected diameter in CSS
  px — full at ≥ `MESH_FADE_FULL_PX` (2 px), gone at ≤ `MESH_FADE_MIN_PX`
  (1 px) (`meshFadeFromPhysPx` on `PlanetBodyField.physicalPlanetSizePx`).
  The eye tracks a resolved body — and its crescent phase, the thing a
  billboard can't show — down to ~1 px, so the mesh persists to that
  limit instead of handing off at the (much larger) perceptual-disc scale.
  Presence is **purely geometric** — `physicalPlanetSizePx` is the one
  size accessor NOT gated on `drawCutoffMag()`, unlike its sibling
  `renderedPlanetSizePx`. A surface is opaque whatever its reflected
  flux, and the alignment where that matters most is the one the
  photometric gate kills: at α → 180° a body sits in front of its own
  host with φ(α) → 0, so gating presence on appMag deleted the mesh —
  and with it the host's occlusion — at exactly the eclipse. The mesh
  correctly renders black there (no ambient term); atmospheric bodies
  keep an airlight limb ring.
- **Reflected glare** is the **shared star-perceptual point** — a planet
  reads *exactly* like a star of its apparent magnitude: size =
  `perceptualAppSizePx(appMag)`, peak =
  `stellataPointSourcePeak(uExposure, appMag, 0.5·physSize) · uGlareGain`
  — the same emission rule the star field runs
  (§ Physical-luminance emission). This is the
  load-bearing invariant: **visibility matches magnitude.** A body
  visible in chart mode (`appMag ≤ slider`) is equally visible here,
  rendered like the naked-eye "wandering star" it is — Mars (~+1.3),
  Jupiter (~−2), Saturn (~+0.5), Venus (~−4) all show, ordered by
  magnitude, exactly as the surrounding star field does. `appMag` already
  folds the phase factor φ(α) (`planetApparentMagnitude`), so a crescent
  is correctly dimmer — no separate illumFrac on brightness. A
  **photocentre shift** toward the sub-solar limb (shape only — brightness
  unchanged), scaled by crescentness `(1−illumFrac)` and resolvedness
  `res`, keeps a barely-resolved crescent's halo off its dark limb (kills
  the ring) while leaving a sub-pixel dot centred. Eclipse folds in as a
  flux multiplier on the peak.

  When **resolved** the mesh draws the surface, writes depth, and occludes
  the glare's core: since the magnitude bloom (`appSize`, capped at
  `uSizeMax`) is smaller than a well-resolved disc (`physSize`), the glare
  is hidden inside the disc and only shows as a lit-limb halo while the
  body is small/bright. The full-Moon calibration
  (`../perceptual-magnitude.test.ts`, −12.7) anchors the underlying flux, so
  the magnitude — and therefore visibility — is correct for any host star.
  CPU mirror for the hover footprint: `max(physSize, appSize)`.

`uGlareGain` (debug-tunable — `setGlareGain`) is the glare peak
multiplier: planet-glare brightness relative to a star of the same
magnitude (1 = identical). When resolved the
**mesh** writes depth (local depth pass), so the additive glare is
naturally occluded to the lit-limb halo — the old core depth-mask is gone.

- **Geometry**: one shared unit sphere, scaled per body to
  `(R_eq, R_eq·(1−f), R_eq)` — `Planet.flattening` carries NASA
  fact-sheet oblateness (Saturn 0.098 is visibly non-spherical).
  Orientation comes from the body's IAU rotation elements
  (§ Planet rotation); bodies without them fall back to pole =
  host orbital-plane normal with an arbitrary fixed meridian.
- **Lighting**: per-fragment Lambert against the planet→host
  direction (view space) — the day/night terminator IS this lighting,
  not imagery. Limb darkening on top; no ambient term, so the night
  side is black (physically honest). Three scalars refine it, all
  CPU-computed per frame from vitest-pinned pure helpers:
  - `uPhaseScale` = φ_body(α)/φ_Lambert(α)
    (`../phase-function.ts:phaseRatioToLambert`, clamped [¼, 4]) corrects
    the disc-integrated output to the body's measured Mallama curve —
    Venus's forward-scattered crescent brightens where the data says.
    A pure function of phase angle (1 at α = 0); an appMag match was
    rejected: it depends on viewer distance and blows out on approach.
  - `uSurfaceLuminance` (`mesh-surface-pure.ts:meshSurfaceLuminance`) —
    the body's **true mean surface brightness** in the scene-wide HDR
    unit, pre-divided by the disc means of everything the shader
    multiplies on top (§ Physical-luminance emission). Surface-only: the
    reflected glare is the star-perceptual point (driven by appMag,
    above), so this shades the mesh, not the glare. Body-kind-agnostic —
    planets, moons, and future lit bodies all read the one scalar.
  - `uAirlightLuminance` (`hostIrradianceLuminance`) — host irradiance on
    the same scale, carrying no surface albedo. Scattered sunlight rides
    it: the disc airlight, the atmosphere shell, and the ring annulus
    (whose strip RGB supplies its own reflectance). Splitting it from
    `uSurfaceLuminance` is what fixes the airlight-to-surface and
    ring-to-body ratios by physics instead of by eye.
  - `uTermSoftness` (`Planet.terminatorSoftness`) — smoothstep
    half-width carrying twilight past the geometric terminator on
    atmospheric bodies (Venus 0.08 widest; Titan the one moon with a
    band; undefined = airless hard cut).
- **Inter-body shadows**: each drawn body carries up to 8 view-space
  caster spheres (`uCasters` — a moon's parent; a planet's moons); the
  fragment shader attenuates the reflected term when the ray toward
  the sun intersects one, with a penumbra half-width of
  `distance × uSunAngRad` (the host's angular disc), so a Galilean
  shadow transit reads as a soft-edged disc on Jupiter and the
  antumbral case falls out naturally. CPU mirror + transit search
  tests in `body-shadow-pure.ts`. Analytic because bodies at
  planet-scale separations share one log-depth bucket in any shadow
  map the main pass could render — and the local pass's z-buffer
  orders camera rays, not sun rays.
- **Textures**: lazy-fetched from `public/textures/<body>.jpg`
  (pipeline: `data/textures/README.md`) when the body crosses
  `TEXTURE_PREFETCH_PX` on approach; first load pays zero. A 404 is
  expected data — texture-less bodies (Uranus, future exoplanets)
  render the representative-colour + limb-darkening base path; there
  is no separate renderer for them. Textures load with
  `NoColorSpace` to match the pipeline's raw-framebuffer convention.
- **Visibility**: the layer's group mirrors `PlanetBodyField.group`
  (chart-mono + hidden ride along for free) and skips the field's
  `hiddenInstanceIdx` (observe anchor).

### Ring systems

Saturn, plus Uranus + Neptune's faint rings at true opacity — spans and
the Jupiter exclusion in `data/textures/README.md` § Ring strips.
`Planet.rings` adds an annulus mesh (`planet-rings.*.glsl`) in the
body's equatorial plane (IAU pole; host orbital plane as the
no-elements fallback), textured by the `<body>-rings.png` 1-D radial
strip (RGB colour, A opacity; U = inner→outer edge). Lit-face
fragments get full strip colour, the unlit face a dimmer
transmitted factor, both fading out as illumination goes edge-on to
the ring plane; the far-side segment inside the body's shadow
(analytic ray–ellipsoid test toward the host) drops to a residual
floor. Rendered only in the mesh-LOD regime: alpha rides the same
crossfade `uFade`, hidden until the strip texture arrives (no
representative-colour fallback), `renderOrder` 2.81 (after the body
mesh) with `depthWrite: false`.

**Body occlusion is the local depth pass's z-buffer**: meshes + annuli
render in the bracketed second pass (`../../local-depth/README.md`),
where standard depth orders ring↔body natively — including the oblate
limb. The analytic ray–ellipsoid helper survives only for the
body-shadow term (sun ray, not camera ray). Geometry drawn near a
planet body in the MAIN pass still cannot depth-test against it (the log
buffer quantises the whole system into one step; `log2(1+w)` is linear
for w ≪ 1) — new close-range geometry belongs in the local pass, not
behind a new analytic trick. Edge-on the zero-thickness annulus thins
to a line, which is the physically honest look.

## Planet rotation

Per-body IAU rotation elements — pole RA/Dec + linear rates, the prime
meridian `W(t)`, the body→ICRS composition the mesh applies, and the
`mapCenterLonDeg` texture metadata riding the same table — live in
`rotation/README.md`.

## Labels

`planet-labels.ts` draws per-body-anchored SVG labels (planets **and**
moons) above the canvas. The label engine is independent of the
chart-mode label engine (`chart-labels.ts`); labels show when a planet
system is attached and the detail cycle permits `planetLabels` (floor
`all`), and are hidden in chart mode so the chart-mode glyph contract
isn't doubled up (`../../scene/README.md` § Detail-level declutter cycle).

Per-body resolvability gate: every label tracks its orbit ring
(`isOrbitRingVisible` — a ring the pixel-gap heuristic dropped means the
body is floor-clamped sub-pixel, so the label would anchor to nothing).
Planets gate on their host-centred ring, moons on their parent-centred
ring — a moon collapsed toward its parent's dot drops its ring (and so
its label) rather than stacking on the parent.

Surface detail beyond what is listed here (banding, axial-tilt cue)
stays **deliberately deferred** to the planet-zoom epic
(`stellata-2f6`); see `SCIENCE.md` § Scope principles — Defer detail
until zoom affordance.
