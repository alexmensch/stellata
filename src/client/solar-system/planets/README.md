# Planet rendering

The two render layers for planet and moon bodies, their shaders, IAU
rotation elements, inter-body shadow math, and per-body labels. The
system contract these read (`Planet`, `PlanetSystem`, `SOL_BODIES`) and
the reflected-light magnitude model live in `../README.md`; atmospheric
airlight is spliced in from `../atmosphere/`.

## Files in this area

```
src/client/solar-system/planets/
  planet-module.ts (+ test)       The planet ObjectKindModule
                                  (../../kinds/README.md): load/attach,
                                  the boot-time Sol host attach behind
                                  `systemsReady`, and the focusable /
                                  card / hover (whose pick returns the
                                  FLAT Target index the click FSM
                                  consumes) / search / SID / pinnable /
                                  focal-hide legs over the field below.
                                  Its scene layer updates the field
                                  only; the mesh layer's update stays
                                  on the shell after the moving-focal
                                  ride, and the SVG labels stay wired
                                  in main.ts (they read the shell's
                                  orbit-rings layer + focus state).
  planet-body-field.ts (+ test)   Instanced planet-body renderer. One
                                  additive reflected-glare pass (+ its
                                  local-pass mirror); the resolved surface
                                  is the spheroid mesh (planet-mesh-layer).
                                  Shares the glow half of perceptual-disc.glsl
                                  with stars — see
                                  ../../star-pipeline/README.md.
                                  pick() adds one gate over
                                  forEachDrawnBodyView: bodyInkVisible,
                                  which reads the LIVE uExposure so the
                                  adaptation cut reaches the pick (§ The
                                  pick's adapted gate).
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
                                  body via setHiddenInstance;
                                  forEachDrawnBodyView skips that instance
                                  too, so the body the camera is parked at
                                  is unpickable rather than invisible and
                                  clickable.
  planet-mesh-layer.ts (+ test)   Close-range spheroid mesh LOD — see
                                  § Planet mesh LOD. Owns the shared
                                  atmosphere uniform block
                                  (sharedAtmoUniforms). Its test pins the
                                  three surfaces' diffuse-attachment gate.
  mesh-crossfade.ts (+ test)      Disc ↔ mesh crossfade band math, pure
                                  (shared shader/CPU contract).
  spheroid-pure.ts (+ test)       polarRadiusRatio — the one source of 1 − f.
  surface-relief/                 DEM relief on the mesh (Moon, Mercury, Mars,
                                  Earth): the tangent frame,
                                  which terms the perturbed normal reaches,
                                  and the horizon that casts its shadows.
                                  Its own README.
  emission/                       The HDR-unit normalisers — the mesh
                                  anchor and the two disc means that
                                  divide out. Its own README.
  textures/                       Which rung of a body's texture ladder to
                                  hold, from the live viewport, the
                                  build-generated table it reads, and the
                                  VRAM budget that releases the rest. Its
                                  own README.
  glare/                          Reflected-glare billboard shaders: the
                                  shared star-perceptual point and the
                                  photocentre shift. Its own README.
  rings/                          Ring-annulus shaders, the radial strip,
                                  and a ring system's share of appMag.
  rotation/                       Pole + prime-meridian elements and the
                                  texture-UV orientation chain — its own
                                  README (§ Planet rotation).
  body-shadow-pure.ts (+ test)    Soft-penumbra ray–sphere shadow math, CPU
                                  mirror of the mesh shader's caster loop.
                                  Io-transit / lunar-eclipse search tests
                                  on the real ephemeris.
  eclipses/                       The event-level half of the same story:
                                  where a shadow axis meets a surface, the
                                  named-eclipse regression corpus pinning it
                                  against NASA's Five Millennium Canon, and
                                  the refracted glow that makes a totally
                                  eclipsed body red. Its own README.
  planet-labels.ts (+ test)       Per-body (planet + moon) SVG labels,
                                  resolvability-gated. See § Labels.
  planet-mesh.vert.glsl,
  planet-mesh.frag.glsl           Lit spheroid shaders (equirect sample,
                                  host-direction Lambert terminator,
                                  representative-colour + limb-darkening
                                  fallback, atmosphere airlight over the disc).
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

## The pick's adapted gate

`forEachDrawnBodyView` gates on `drawCutoffMag`, which deliberately
**excludes** the per-frame adaptation cut — every cached consumer of it
would thrash on a value that moves each frame
(`../../hdr/exposure/README.md`). A pick caches nothing: it runs on a
pointer event, walks the hosts fresh and discards everything, so it can
read the live `uExposure` — and must, or a parked body blacks out the
whole faint end while leaving every one of those bodies clickable.

`bodyInkVisible` is that extra gate, and it is the star pipeline's own
test: the glare IS the shared star-perceptual point (`glare/README.md`),
so it runs through `emitterPutsInkOnScreen` unchanged, `tapered` always
true because a body carries no opaque disc pass. The mesh OR-branch is
`forEachDrawnBodyView`'s, unchanged — an opaque surface is pickable at
any exposure, which is why a **parked** body always picked correctly and
the gap only ever showed on a distant faint one.

**Chart adds no test of its own here.** It inherits no exposure state, and
`drawCutoffMag` already hard-clips it at the instrument limit upstream, so
every body reaching this gate in chart mode has passed that clip — the
branch returns true rather than restating it. Both gates read the one
`PlanetView.physDiscPx`, derived in `evalPlanetView`, so the
mesh-presence measure has a single source.

## True-eclipse dim

A planet crossing behind its host's *physical disc* (superior
conjunction inside the host's angular radius) dims by the occluded area
fraction — the same camera-anywhere geometry the binaries eclipse
photometry runs (`../../binaries/eclipse/eclipse-photometry-pure.ts`:
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
it. **Unless the caster has an atmosphere**: Earth refracts sunlight into
its own umbra, so the dim floors at that glow rather than 0 and a totally
eclipsed Moon stays visible, coppery red, label and all
(`eclipses/README.md` § Umbral glow). Glare through the host's
perceptual *halo* stays undimmed — the halo is a perceptual
artefact, not a surface, so a body behind it correctly shines
through. A planet in *front* (transit) dims the
host by (R_p/R_host)² — negligible and owned by the star pipeline,
so it is deliberately not modelled.

## Physical-luminance emission

Both layers emit into the scene-wide HDR unit
(`../../hdr/emission/README.md` § Unit) — the glare through the point-source rule, the mesh through the
surface-brightness rule, and past 1 px the two are the same quantity, so
the resolve step is continuous by construction. The mesh anchor, the two
disc means that divide out, and the colour bookkeeping that keeps a
gamma-bent albedo from lighting the body live in `emission/README.md`.

The three alpha-composited surfaces — mesh, annulus, atmosphere shell — are
`markOccludingEmitter` rather than `markStatisticEmitter`, so they dim the
diffuse attachment by their own opacity as well as emitting. The additive
glare needs nothing: an additive blend cannot attenuate
(`../../hdr/attachments/README.md` § The gate).

**They are also the only emitters in the client that claim lit-surface
coverage**, the term the exposure pin divides its masked mean by
(`../../hdr/exposure/README.md` § Adaptation). The mesh claims its **lit
hemisphere alone** — `step(0, sunCos) · step(0.5, shadow)`, the geometric
terminator, so a crescent exposes its crescent rather than being pulled
dark by the night side it happens to present. **Each of the other two gates
on its own illumination the same way** and for the same reason, over a dark
region of its own — the shadowed strip for the annulus (`rings/README.md`),
the unlit chord for the shell (`../atmosphere/README.md`); the pinned table
is `../../hdr/attachments/README.md` § The unit. The glare claims nothing:
it draws a kernel, and its flux belongs in the frame mean only.

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
  reads exactly like a star of its apparent magnitude, on the same
  emission rule the star field runs. That is the load-bearing invariant:
  **visibility matches magnitude.** The billboard's own behaviour — the
  photocentre shift and why a resolved mesh hides the glare's core — is
  `glare/README.md`.

- **Geometry**: one shared unit sphere, scaled per body to
  `(R_eq, R_eq·(1−f), R_eq)` — `Planet.flattening` carries NASA
  fact-sheet oblateness (Saturn 0.098 is visibly non-spherical), via
  `spheroid-pure.ts:polarRadiusRatio` and nowhere else
  (`../atmosphere/README.md` § Shell extents says why).
  Orientation comes from the body's IAU rotation elements
  (§ Planet rotation); bodies without them fall back to pole =
  host orbital-plane normal with an arbitrary fixed meridian.
- **Lighting**: per-fragment Lambert against the planet→host
  direction (view space) — the day/night terminator IS this lighting,
  not imagery. Limb darkening on top; an airless night side is black (no
  ambient term), an atmospheric one is lit by twilight
  (`../atmosphere/README.md` § Skylight). Three scalars refine it, all
  CPU-computed per frame from vitest-pinned pure helpers:
  - `uPhaseScale` = φ_body(α)/φ_Lambert(α)
    (`../phase-function.ts:phaseRatioToLambert`, clamped [¼, 4]) corrects
    the disc-integrated output to the body's measured phase curve —
    Venus's forward-scattered crescent brightens where the data says,
    and the Moon's half phase darkens 1.36 mag onto the lunar law.
    A pure function of phase angle (1 at α = 0); an appMag match was
    rejected: it depends on viewer distance and blows out on approach.
    It multiplies **every** reflected term, terrain interreflection
    included — on one of them alone it would divide into the ratio
    between them (`surface-relief/README.md` § Shadows are lit by the
    terrain). Scattered air light is the exception and normalises
    separately (`emission/README.md` § Two disc means).
  - `uSurfaceLuminance` (`mesh-surface-pure.ts:meshSurfaceLuminance`) —
    the body's **true mean surface brightness** in the scene-wide HDR
    unit, pre-divided by the disc means of everything the shader
    multiplies on top (§ Physical-luminance emission) and, for an
    atmospheric body, less the share of that flux its airlight already
    supplies (`../atmosphere/README.md` § Flux bookkeeping). Surface-only: the
    reflected glare is the star-perceptual point (driven by appMag,
    above), so this shades the mesh, not the glare. Body-kind-agnostic —
    planets, moons, and future lit bodies all read the one scalar.
  - `uAirlightLuminance` (`hostIrradianceLuminance`) — host irradiance on
    the same scale, carrying no surface albedo. Scattered sunlight rides
    it: the disc airlight, the atmosphere shell, and the ring annulus
    (whose strip RGB supplies its own reflectance). Splitting it from
    `uSurfaceLuminance` is what fixes the airlight-to-surface and
    ring-to-body ratios by physics instead of by eye.
  - `uTermSoftness` (`Planet.terminatorSoftness`) — by-eye widening of
    the terminator (Venus 0.08 widest; Titan the one moon with a band;
    undefined = airless hard cut). What actually lights the night side
    is a separate physical term — `../atmosphere/README.md` § Skylight.
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
- **Textures**: lazy-fetched from `public/textures/<body>-<rung>.jpg`
  (pipeline: `data/textures/README.md`) when the body crosses
  `TEXTURE_PREFETCH_PX` on approach; first load pays zero. Which rung is
  § Texture tier selection. A 404 is
  expected data — texture-less bodies (Uranus, future exoplanets)
  render the representative-colour + limb-darkening base path; there
  is no separate renderer for them. Textures load with
  `NoColorSpace` to match the pipeline's raw-framebuffer convention.
  They decode through `ImageBitmapLoader` on `TEXTURE_DECODE_OPTIONS`,
  never `TextureLoader`: the flip is baked into the bitmap, so
  orientation never rests on `UNPACK_FLIP_Y_WEBGL`, whose tracked
  value a raw pixel-store write elsewhere can desync from GL
  (`../../loaders/README.md`) — a map that arrives unflipped shades
  the mirrored hemisphere and looks like nothing else is wrong. The
  same options forbid premultiplication, which would let each horizon
  map's alpha-borne azimuth scale the other three.
  Either outcome resolving requests a frame (`ctx.requestRender`): a
  load landing between ticks changes what the body draws, and frames
  are on demand (`../../render-gate/README.md`).
- **Visibility**: the layer's group mirrors `PlanetBodyField.group`
  (chart-mono + hidden ride along for free) and skips the field's
  `hiddenInstanceIdx` (observe anchor).

### Texture tier selection

`textures/` — each body ships a ladder of map widths and the renderer holds
the smallest rung its display can resolve, from
`2 · physicalPlanetSizePx · pixelRatio`. Round up, lead the swap up, hold
across a dead band, drop once the body has shrunk well past what it holds;
every rung shares one build-measured mean luminance, or a swap would step the
disc's brightness.

**Maps are released, which the ladder makes mandatory rather than tidy** — an
8192 map is 179 MB against a 2048's 11 MB. A body keeps exactly one rung; the
rest rides a least-recently-drawn budget. Dropping matters most for a body
still ON screen but small — used every frame, so beyond that budget's reach.

### Surface relief

Moon, Mercury, Mars and Earth shade with a DEM-derived normal map, a horizon
map and a sky-view factor over the colour map, all on the same approach lane.
Earth's are twice the width of the other three — its relief is far the
flattest and buys nothing below 8192. The tangent frame, the single term the
perturbed normal may reach, how the facet's own slope composes with the
skyline beyond it — the body's own limb included — and why the sky the ground
sees needs a different march from the sun it sees, are
`surface-relief/README.md`; the shader is `planet-mesh.frag.glsl` here.

### Ring systems

`rings/README.md` owns all of it: the annulus shaders, the strip's
lit/transmitted faces, why rings dim a source behind them while writing no
depth, and the joint phase-angle / ring-tilt law carrying a ring system's
share of the *unresolved* magnitude — on a per-frame attribute
(`iRingFlux`), unlike the phase polynomial, because β is camera-dependent.

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
