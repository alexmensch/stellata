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
     brightest planet would just cross the magnitude slider
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
slider visibility cutoff applies — sub-cutoff planets fade naturally,
no unconditional pixel floor. The glare is one pass (main-pass draw +
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
- **Reflected glare** is the **shared star-perceptual point** — a planet
  reads *exactly* like a star of its apparent magnitude: size =
  `perceptualAppSizePx(appMag)`, peak = `uGlareGain` (≈1). This is the
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

Known refinement (smoke): a dim-surfaced body's resolved mesh (compressed
`uLitIntensity`) can read dimmer than its own peak-1 glare, so there is a
mild luminosity step as it resolves and a bright unresolved moon can look
brighter than a resolved dim-surfaced parent. Visibility (the hard
requirement) takes priority; matching resolved-surface brightness to the
point scale is a separate mesh-shading calibration.

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
  - `uLitIntensity` (`../perceptual-magnitude.ts:hostIntensityScale`) —
    **host irradiance at the body** on a quarter-power display
    compression, folding the host's absolute magnitude so surface
    brightness scales with **star class**: the ratio is
    `(E_body / E_ref)^0.25` where `E_body / E_ref =
    10^(0.4·(HOST_IRRADIANCE_REF_MAG − m_host@body))` and
    `m_host@body = M_host + 5·(log10(d_hp) − 1)`. For Sol it reduces
    exactly to the old `(d_AU)^(−0.5)` law (reference 1 AU ⇒ Earth = 1,
    Mercury ~1.6× clamped, Neptune ~0.18×); a body 1 AU from an O-class
    host is far brighter, by star class alone. Clamped to
    `[0.12, 1.6]` — the LDR compression H5 replaces with true surface
    brightness. **No sensitivity term**: the magnitude slider is the
    tone-map exposure now (`../../hdr/README.md` § Exposure epochs), so
    a second quarter-power slider composition here would put planets on
    a rival exposure curve — the cost is that the slider does not move
    a planet's brightness at all until H5 converts these layers.
    No viewer-distance term either, so approach can't blow it out; the
    ring annulus multiplies the same scalar so ring↔body contrast is
    preserved. Surface-only: the reflected glare is the star-perceptual
    point (driven by appMag, above), so `uLitIntensity` shades the mesh
    and ring, not the glare. Body-kind-agnostic: planets, moons, and
    future lit bodies all read the one scalar the mesh layer computes.
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
