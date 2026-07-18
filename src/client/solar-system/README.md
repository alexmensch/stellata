# Solar-system layer

Solar-system layer (`stellata-3re`). When a focusable star carries a planet
system, Stellata renders the planets as billboarded discs at their
heliocentric positions, faint orbit rings on the host's orbital plane,
and (Sol only) the heliopause boundary as a translucent asymmetric
shell. Sol is the only populated host so far; the framework is
deliberately generic so the future exoplanet epic (`stellata-bk5`)
can plug in without changing the renderer.

## Files in this area

```
src/client/solar-system/
  planet-system.ts                Planet / PlanetSystem contract.
                                  hasPlanets + getPlanetSystem; SOL_PLANETS
                                  table (eight majors + Pluto) + SOL_MOONS
                                  table (18 major moons; see § Moons).
  sol-object-sids.ts              SOL_OBJECT_SIDS — hand-written body →
                                  frozen Stellata ID pins (Sun + planets).
                                  See § Sol-system SID pins.
  ephemeris.ts                    JPL Standish 1992 Keplerian-elements
                                  approximation + cubic Jupiter–Neptune
                                  correction terms. Heliocentric ecliptic
                                  parsecs out.
  moon-ephemeris.ts               MOON_ELEMENTS — J2000 osculating orbital
                                  elements for the 18 major moons, each
                                  with its reference-plane pole. Data table
                                  + type only; resolver lands later. See
                                  § Moons.
  time.ts                         Simulation time `t` + UTC ↔ Julian-day
                                  helpers. Owns `VirtualClock`, the clock
                                  behind `Stellata.getT()`, plus the
                                  FF/RW rate transitions, rate label, and
                                  the TRANSPORT_BUTTONS action spec.
                                  Single source of truth for the scrubber.
  time-scrubber-widget.ts (+pure) First-class scrubber in the bottom-right
                                  meta slot (T key / click the readout).
                                  Transport controls (play/pause/FF/RW/reset)
                                  over the VirtualClock, built from
                                  TRANSPORT_BUTTONS; app-styled, with a
                                  human "time / second" rate readout
                                  (formatRatePerSecond, pure + tested).
  sky-truth.test.ts               Regression corpus: the ephemeris →
                                  ecliptic→ICRS chain vs JPL Horizons
                                  RA/Dec frozen in data/horizons/, plus
                                  solstice/equinox mirror detectors.
  time-readout.ts                 UTC readout display next to the time
                                  scrubber.
  planet-body-field.ts            Instanced planet-body renderer. Three-pass
                                  (depth-only mask + disc + glow), shares
                                  the unified disc/glow chunk with stars
                                  (perceptual-disc.glsl) — see
                                  src/client/star-pipeline/README.md.
                                  Also the identity table for Target
                                  {kind:'planet'}: flat instance index ↔
                                  (host, planet-within-host), plus local/
                                  absolute position, appMag, and rendered-
                                  size accessors keyed on the flat index.
                                  uHideIdx (one uniform shared by all
                                  five passes) hides the observe-anchor
                                  body via setHiddenInstance.
  orbit-rings-layer.ts            Faint orbit rings in the host's orbital
                                  plane.
  planet-mesh-layer.ts            Close-range spheroid mesh LOD — see
                                  § Planet mesh LOD.
  mesh-crossfade.ts (+ test)      Disc ↔ mesh crossfade band math, pure
                                  (shared shader/CPU contract).
  planet-mesh.vert.glsl,
  planet-mesh.frag.glsl           Lit spheroid shaders (equirect sample,
                                  host-direction Lambert terminator,
                                  representative-colour + limb-darkening
                                  fallback, emissive night-lights blend).
  planet-rings.vert.glsl,
  planet-rings.frag.glsl          Ring-annulus shaders (radial strip
                                  sample, lit/transmitted faces, body
                                  shadow) — see § Planet mesh LOD.
  rotation-elements-pure.ts       IAU rotation elements per body (pole +
                                  prime meridian on the model clock) —
                                  see § Planet rotation.
  perceptual-magnitude.ts         Per-planet apparent-magnitude model
                                  (Lambertian + Mallama phase factors).
                                  Drives both the body field's disc/glow
                                  sizing and the per-planet label gating.
  phase-function.ts (+ test)      Lambertian + Mallama phase functions.
                                  Pure helpers with vitest coverage.
  planet-labels.ts                Per-planet SVG labels, distance-gated.
  heliopause.ts                   Sol's heliopause boundary as a translucent
                                  asymmetric shell (Sol-only).
  first-load.ts                   Canonical no-URL first-load view: 5 AU
                                  galactic-centre-aimed park.
  planet.vert.glsl,
  planet.frag.glsl                Three-pass instanced planet bodies.
                                  Imports `perceptual-disc.glsl` from
                                  `../star-pipeline/` (shared disc/glow
                                  chunk with stars).
  heliopause.vert.glsl,
  heliopause.frag.glsl            Asymmetric heliopause shell shaders.
```

## Data model

`planet-system.ts` defines the contract every host's planet system
satisfies:

- `Planet` — name, equatorial radius (km), semi-major axis (AU),
  eccentricity, type (`rocky` / `gas_giant` / `ice_giant` / `icy`),
  representative RGB colour. Optional `parentName` marks a body that
  orbits a planet rather than the host star (a moon); optional
  `gravParamGM` (km³/s²) is carried by moon parents so a moon's period
  derives from its parent's mass, not the host star's.
- `PlanetSystem` — host star catalog index, `planets` array,
  optional `positionsAt(t, out)` resolver writing 3 floats per planet
  in the host's local orbital-plane frame, optional
  `orbitOrientations` for the orbit-ring renderer.

Sync probe: `hasPlanets(catalog, idx)` — currently hardwires "planets ⇔ Sol".
Async resolver: `getPlanetSystem(catalog, idx)` returns the system or
`null`. The Promise wrapper is intentional so `bk5` can lazily fetch
per-host JSON shards without changing the call sites.

`SOL_PLANETS` is the eight major planets + Pluto with constants
sourced from NASA Planetary Fact Sheets (radii) and JPL DE440 (mean
elements at J2000). Pluto comes from New Horizons 2015 reconnaissance.
See `docs/science-solar-system.md` §Solar system for the citation rationale.

## Moons

`SOL_MOONS` (in `planet-system.ts`) is the 18 major moons as `Planet`
entries: Earth's Moon; the four Galileans; seven Saturnian moons;
five Uranian moons; and Triton. Physical props (`MOON_PHYSICAL`) live
next to `SOL_PLANETS`; orbital `a`/`e` are read from `MOON_ELEMENTS`
by name so they have a single source of truth. Scope + citations in
`docs/science-solar-system.md` § Moons.

`SOL_MOONS` is **not** part of `SOL_PLANETS`. The body field iterates
one array and expects a position for every entry, so a moon appended
before its resolver exists would render at the origin. Moons attach to
the runtime system separately, with position composition, focus, and
orbit rings, in later work — until then this is inert data.

Orbital elements (`moon-ephemeris.ts`) are J2000 osculating, each
referred to the plane JPL tabulates it against, with that plane's ICRS
pole stored per moon (`refPoleRaDeg`/`refPoleDecDeg`): the local
Laplace plane for most, Uranus's equator for the Uranian regulars,
and the ecliptic for the Moon (no pole — the Moon tracks the ecliptic,
not Earth's equator). The resolver rotates each orbit from its
reference plane into the ecliptic before composing it onto the parent's
heliocentric position.

## Sol-system SID pins

`sol-object-sids.ts` maps each Sol body (`sun`, `mercury` … `pluto`) to
its frozen Stellata ID (docs/sid.md § 7). Planets and the Sun carry no
catalog record or artifact of their own, so this hand-written table is
their runtime SID source — the B4 resolver (`stellata-efju.5`) will
register a `planet` domain over it. The values are frozen ledger sids
minted from `data/sid/sol-objects.tsv`; `sol-object-sids.test.ts` imports
the ledger and asserts each entry matches (tests import, never redefine),
covers exactly the mint list, and pins a sid for every `SOL_PLANETS`
body. `sol:sun` rides the Sol **catalog** record via a same-as edge, so
that record's in-record sid and `SOL_OBJECT_SIDS.sun` are the same integer
by construction.

## Ephemerides

`ephemeris.ts` implements the **JPL Standish 1992 Keplerian-elements
approximation** with the cubic Jupiter–Neptune correction terms
(Table 2a/2b inlined). Sub-arcminute accuracy 3000 BC – 3000 AD,
which is overkill for billboarded discs that floor at ~2 px regardless
of zoom. VSOP87 was rejected: the precision difference is invisible at
user-reachable framings and the dependency cost was not worth it.
Deep-time never arises — the model clock clamps to the Standish window
(§ Time `t` and the readout), so no reachable `t` needs a
higher-precision ephemeris.

Returned positions are heliocentric **ecliptic** parsecs, not ICRS —
the rotation onto ICRS happens in the caller via the per-host
orbital-plane orientation quaternion. Sol's quaternion is the J2000
obliquity rotation; future exoplanet hosts (`bk5`) get a galactic-
plane-aligned default per the 3re.8 rule below.

Per-`t` cache granularity is 60 seconds. At billboarded-disc pixel
scale, sub-minute planet motion is invisible — Mercury moves ~3e-5 rad
seen from Earth over 60 s, well below pixel resolution at any zoom we
afford. The cache key is `t / CACHE_GRANULARITY_SEC` floored, so
multiple frames within the same minute reuse the same `Vec3` triplet.
Under scrubber fast-forward the sim-time step per frame quickly
exceeds the bucket, so the cache simply misses every frame and the
positions stay smooth; reducing the granularity finer is just a
bucketisation change if ever needed.

## Time `t` and the readout

`time.ts` defines `t` as a Unix-seconds double. `Stellata.getT()` reads
it from a `VirtualClock`: `t = simT0 + rate · (wallNow − wallT0)`, so at
`rate = 1` in steady state it tracks `Date.now() / 1000` exactly (the
parity every existing consumer relies on). This is the ONLY place
wall-clock is sampled for the simulation `t`.

The scrubber widget (`time-scrubber-widget.ts`) drives the clock:
play / pause / fast-forward / rewind / reset / jump-to-date. FF and RW
step through **powers of two** (`±1, ±2, … ±2³²`) and cross zero directly
— a step from `+1×` lands on `-1×` rather than passing through fractional
slow-motion, since the binary orbits this scrubber verifies (α Cen 80 yr,
61 Cyg 664 yr) are only ever watched *faster* than wall-clock. Rate flips
snapshot the current virtual time so scrubbing never teleports. `|rate|`
saturates at `2³²` (~4.29e9×). `Stellata.setT(n)` freezes the clock at a
specific instant (URL-restore of a scrubbed view); `setT(null)` resets to
live.

`t` itself is clamped to the Standish ephemeris validity window
(3000 BC – 3000 AD; `T_CLAMP_MIN_S` / `T_CLAMP_MAX_S`) — every clock
mutation and `getT()` read clamps, so no consumer ever sees an epoch
where planet positions (or linear star propagation) are garbage. A
running clock **pins at the bound** with its rate intact: the readout
freezes there, no invisible overshoot accrues (the clock re-anchors at
the bound), and the first opposite-direction transport step moves off
it immediately. See SCIENCE.md § Solar system for the decision record.

Jump-to-date is a native `datetime-local` input whose value is
read as **local** time (`toLocalDatetimeValue` / `parseLocalDatetimeValue`
in `time.ts`), even though the readout displays UTC — deliberate, so it
matches the operator's wall clock. The calendar-popup indicator is hidden
in CSS (`.scrubber-jump input::-webkit-calendar-picker-indicator`): the
segmented fields are typed by hand, avoiding both the out-of-place native
picker and the format-error trap of a plain text box. Reset already snaps
to live-now at 1×, so there is intentionally no separate "now" jump.

`time-readout.ts` renders the live UTC timestamp the rendered positions
correspond to. It mounts the collapsed `.meta` readout (`#time-readout`, a
button that opens the scrubber); while the scrubber is expanded, that
readout is hidden and the scrubber's own readout takes over. Either way the
current model time stays on screen in every mode (free fly, chart, warp,
observe) — binary orbital evolution ticks against `getT()` throughout, so
the user always benefits from knowing which moment is being rendered.

Format is plain-English UTC: `D MMM YYYY, HH:MM:SS UTC`
(e.g. `7 May 2026, 18:23:45 UTC`). Locale-independent — month
abbreviations are hard-coded en-US to avoid DD/MM vs MM/DD ambiguity
across browsers.

**Variable-star pulsation runs on `t`.** It was once driven by a separate
cosmetic `uTime` real-seconds clock, deliberately decoupled from `t`; that
decision is now reversed. Pulsation phase reads the model clock through
`uModelDays` (= days since J2000 from `getT()`) at real GCVS periods, so it
responds to the time-warp exactly like binary orbital motion — see
`star-pipeline/README.md` § Variable star rendering. The old `uTime` /
`uSecondsPerDay` uniforms are gone.

## Time scrubber widget

`time-scrubber-widget.ts` is the scrubber — a first-class control living
in the bottom-right `.meta` slot. Collapsed,
`.meta` shows the star count + live UTC readout (the readout is a button
that opens the scrubber); the `T` shortcut and clicking the readout both
toggle it. Opened, it replaces that with a model-time readout + transport
controls + a `datetime-local` jump, and an `×` collapses back. Toggling
open/closed never changes the clock — only **Reset** returns to live-now
at 1×.

While the scrubber is open, `←`/`→` rewind/fast-forward, `Space` toggles
play/pause, and `Backspace` resets. These dispatch from the central
`ui/keyboard-shortcuts.ts` (not a second keydown listener) through the
widget's `stepBack` / `stepForward` / `togglePlay` / `reset` — the same
`press(action)` path the buttons use. The dispatcher's `targetIsEditable`
guard leaves the jump date-field's native arrow-key segment editing intact
when it's focused.

The `.meta` slot lives in the right-hand control column's bottom group
(`.ui-top-bottom`), so an expanding scrubber pushes the focus card up
through normal flex layout — see `../ui/README.md` § Layout containers.

It drives the `VirtualClock`, building its transport row from `time.ts`'s
`TRANSPORT_BUTTONS`. The controls render as monochrome line-art SVG glyphs
(`transportIcon`, `currentColor` stroke) — thin-line iconography matching
the rest of the app rather than platform emoji, all one size so reset reads
as prominently as play/pause. Rate shows as a human "time / second" phrase
(`formatRatePerSecond`, pure + unit-tested). Colours ride the root CSS
tokens so chart mode (`body.monochrome`) adapts; only the translucent
panel background carries an explicit light-mode override in `styles.css`.
The catalogue moves with the scrubbed clock too — star positions
re-advance off their J2016.0 baseline on 1/20-Julian-year bucket
crossings (`../loaders/README.md` on `epoch-advance-pure.ts`;
SCIENCE.md § Current-epoch star positions) — but this widget stays
clock-only and never touches positions itself.

## Planet rendering

Planet rendering splits across two layers (stellata-3re.15):

- **`planet-body-field.ts`** — global, instanced mesh holding every
  attached host's planet bodies. Sol attaches once at startup; bk5
  will iterate exoplanet hosts in. Bodies are physical objects:
  they render whenever attached, regardless of which host the camera
  is focused on. Each frame, for each host:

  1. Skip the work entirely if the camera is past the host's
     `cullDistancePc` — the closed-form distance at which its
     brightest planet would just cross the magnitude slider.
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

- **`orbit-rings-layer.ts`** — per-host orbit-ring layer. Geometry
  rebuilds whenever the focused star's PlanetSystem changes; per-frame
  tick drives the pixel-gap visibility heuristic. Representational
  only — rings hide when the host loses focus. The ring group rides
  the host's live renderer-local position (fed each frame from
  `PlanetBodyField.getHostLocalPositionInto`), and the pixel-gap
  heuristic measures camera-to-host distance — under planet focus the
  floating origin sits on the planet, so the host is NOT at the local
  origin.

**True-eclipse dim (stellata-2f6.4).** A planet crossing behind its
host's *physical disc* (superior conjunction inside the host's
angular radius) dims by the occluded area fraction — the same
camera-anywhere geometry the binaries eclipse photometry runs
(`binaries/eclipse-photometry-pure.ts`: `eclipseDimFromOffsets` +
the shared anti-strobe blend helpers). `PlanetBodyField.update`
evaluates each in-range host's planets per frame (the pair-relative
offset is `iLocalRel` itself — small values, no large-position
differencing) and writes the per-instance `iEclipseDim` attribute;
the vertex shader folds it into appMag in the **glow pass only**,
mirroring the star pipeline's fold. A FULL eclipse writes exactly 0
and the shader collapses the quad — a floored +7.5 mag residual is
still visible on a mag −1 Mercury, and the planet-scale depth buffer
can't hide it — and the planet's label hides with it (the fully
eclipsed body renders nothing). Glow through the host's
perceptual *halo* stays undimmed — the halo is a perceptual
artefact, not a surface, so a body behind it correctly shines
through. The disc pass needs no dim or depth bias: its
per-channel-max blend keeps the darker back disc from painting over
the host's saturated disc. A planet in *front* (transit) dims the
host by (R_p/R_host)² — negligible and owned by the star pipeline,
so it is deliberately not modelled.

Bodies render as billboarded discs through the same perceptual-disc
abstraction the star pipeline uses (`shaders/perceptual-disc.glsl`).
Apparent magnitude is computed in the vertex shader from reflected
host-star light through a per-planet phase function — Mallama 2018
empirical polynomials for Mercury, Venus, Earth, Mars, Jupiter and
Saturn (3re.18); Lambertian fallback for Uranus, Neptune, Pluto and
every exoplanet (`stellata-bk5`), since Mallama 2018 publishes no
phase-angle polynomial for those. The slider visibility cutoff
applies — sub-cutoff planets fade naturally, no unconditional pixel
floor. Five passes: the star-pipeline trio (core depth-mask + disc
+ glow) plus a planet-only **corrupt + restore** pair around the
orbit ring layer (stellata-3re.19). The CORRUPT pass
(`uRenderMode == 3`, renderOrder 1.5) writes `gl_FragDepth = 0.0`
across the planet's bright body (`glow >= uCoreThreshold`); the orbit
ring at renderOrder 2 then depth-fails for every fragment landing on
the body — far-side AND near-side, regardless of the ring's actual 3D
position. The RESTORE pass (`uRenderMode == 4`, renderOrder 2.5,
`depthFunc: AlwaysDepth`) writes the planet's actual `gl_FragCoord.z`
back across the same region so disc / glow at 3 / 4 still depth-test
correctly against other planets and stars. Background layers (MW /
clouds / stars) paint colour into the framebuffer before the corrupt
pass overwrites depth, so they still peek through the perceptual
halo. Surface detail (textures, atmospheric haloes,
banding, axial-tilt cue) stays **deliberately deferred** to the
planet-zoom epic (`stellata-2f6`); see `SCIENCE.md` § Scope principles
— Defer detail until zoom affordance.

### Apparent-magnitude formula

For a planet of geometric albedo `p` and equatorial radius `R`, with
the viewer at distance `d_vp` from the planet and the host at `d_hp`
from the planet:

```
m_host_at_planet = M_host + 5·log10(d_hp / 10pc)
m_planet         = m_host_at_planet
                 − 2.5·log10( p · (R/d_vp)² · φ(α) )
```

The viewer→host distance cancels out of the physical formula and must
not appear in either the shader or the CPU mirror: observe mode parks
the camera exactly at the host, so any `d_vh` term evaluates `log(0)`
there and kills every planet of the focused host (the
planets-invisible-in-observe regression).

`α = ∠(viewer–planet–host)` is the phase angle and `φ(α)` is
the per-planet phase factor — Mallama 2018 empirical polynomial
`10^(−ΔV(α)/2.5)` inside each planet's published α range, anchor-
scaled Lambertian past it (Lambert(α) × poly(αmax)/Lambert(αmax) so
brightness stays continuous and each planet's empirical character
extends past αmax instead of snapping to a uniform Lambertian
sphere), pure Lambertian `(sin α + (π − α)·cos α)/π` for bodies
without published curves. Verified Jupiter values (under Lambert):
−2.7 from Earth at opposition, +5.2 from ~150 AU outside the
heliopause, +21 from α Cen at 1.34 pc.

### Per-host distance cull

Closed-form bound on the visibility distance for the brightest
planet of an attached host:

```
d_cull = 10 pc · √(p · (R/a)²) · 10^((maxAppMag − M_host) / 5)
```

where `(R/a)` for the brightest planet (proxy for "roundtrip flux")
makes the formula geometry-independent. Sol's Jupiter under naked-eye
preset gives ~290 AU — confirming that any non-Sol focus already
collapses Sol's bodies far past the cull distance, exactly as
intended. `PlanetBodyField.setMaxAppMag` recomputes the cache on
every slider move.

### Planet mesh LOD (stellata-2f6.9)

On close approach the billboarded disc hands off to a real oblate
spheroid mesh (`planet-mesh-layer.ts`), crossfaded on the ratio of
the body's TRUE projected diameter to its perceptual disc size —
`mesh-crossfade.ts` owns the band (physSize/appSize 1.0 → 1.5) and
both sides evaluate the same smoothstep (shader: `uMeshFadeRatio`;
CPU: `PlanetBodyField.meshFadeRatio` → `meshFadeFromRatio`). The band
starts at ratio 1, exactly where the disc's `max(appSize, physSize)`
switches to the physical term, so the mesh (drawn at physSize) and
the disc share the same footprint through the whole fade — the
handoff can't pop in size, and the disc passes multiplying by
`1 − vMeshFade` against the mesh's rising `uFade` means no
double-brightness either. The
core / corrupt / restore depth passes deliberately keep running
through the fade — the mesh silhouette matches the disc core, so the
ring-occlusion dance is preserved (full mesh-era ring clipping is
stellata-2f6.3).

- **Geometry**: one shared unit sphere, scaled per body to
  `(R_eq, R_eq·(1−f), R_eq)` — `Planet.flattening` carries NASA
  fact-sheet oblateness (Saturn 0.098 is visibly non-spherical).
  Orientation comes from the body's IAU rotation elements
  (§ Planet rotation); bodies without them fall back to pole =
  host orbital-plane normal with an arbitrary fixed meridian.
- **Lighting**: per-fragment Lambert against the planet→host
  direction (view space) — the day/night terminator IS this lighting,
  not imagery. Limb darkening on top; no ambient term, so the night
  side is black (physically honest).
- **Earth night lights** (stellata-2f6.14): `Planet.hasNightTexture`
  lazy-loads the `<body>-night.jpg` companion (Black Marble) with the
  day map; the shader adds it as an *emissive* term (no limb
  darkening) ramping in across a ±0.05 dot(n, sun) band around the
  terminator, so the day→lights handoff has no hard seam. With IAU
  rotation on `getT()`, the actually-dark hemisphere shows its lights
  at model time.
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
- **Ring systems** (Saturn, plus Uranus + Neptune's faint rings at
  true opacity — spans and the Jupiter exclusion in
  `data/textures/README.md` § Ring strips): `Planet.rings` adds an
  annulus mesh (`planet-rings.*.glsl`) in the body's equatorial plane
  (IAU pole; host orbital plane as the no-elements fallback),
  textured by the `<body>-rings.png` 1-D radial strip (RGB colour,
  A opacity; U = inner→outer edge). Lit-face
  fragments get full strip colour, the unlit face a dimmer
  transmitted factor, both fading out as illumination goes edge-on to
  the ring plane; the far-side segment inside the body's shadow
  (analytic ray–ellipsoid test toward the host) drops to a residual
  floor. Rendered only in the mesh-LOD regime: alpha rides the same
  crossfade `uFade`, hidden until the strip texture arrives (no
  representative-colour fallback), `renderOrder` 2.81 (after the body
  mesh) with `depthWrite: false`. **Body occlusion is analytic, not
  depth-tested**: at planet scale the log-depth buffer quantises the
  whole solar system into one depth step (`log2(1+w)` is linear for
  w ≪ 1), so the ring fragment shader discards fragments whose
  camera→fragment segment passes through the body ellipsoid — the
  same ray–ellipsoid helper as the shadow test, with a camera ray.
  Any future geometry drawn near a planet body must use the same
  trick; the depth buffer cannot separate planet-scale distances.
  Edge-on the zero-thickness annulus thins to a line, which is the
  physically honest look.

### Planet rotation (stellata-2f6.13)

`rotation-elements-pure.ts` carries per-body IAU rotation elements —
pole RA/Dec (ICRS) + linear century rates, and prime-meridian angle
`W(t) = W0 + Ẇ·d` — the main linear terms from the IAU WG on
Cartographic Coordinates and Rotational Elements 2015 report
(Archinal et al. 2018), as distributed in NAIF `pck00011.tpc`. The
sub-degree periodic nutation/precession terms are dropped: at render
scale they're invisible (largest is Neptune's ±0.7° pole nod), and
the linear pole rates already carry the visually meaningful part
(Earth's axial precession drifts the pole ~30° across the model-clock
window). `t` is treated as TDB via `tToJDE` — the ~69 s UTC↔TDB gap
is ~0.3° of Earth spin, accepted repo-wide.

The mesh layer composes body→ICRS as `Rz(90°+α0)·Rx(90°−δ0)·Rz(W)`
(the IAU convention: body +z = pole, +x = prime meridian, W measured
from the node of the body equator on the ICRS equator), then the
geometry pole tilt (+Y → +z). Driven off `getT()` each frame like
binary orbits, so the scrubber spins planets and the day side tracks
the actual model-time hemisphere. `Planet.rotation` is optional —
bodies without published elements (exoplanets) keep the fallback
pole = host orbital-plane normal with an arbitrary fixed meridian.

`RotationElements.mapCenterLonDeg` is texture metadata riding the
same table: the east longitude at the horizontal centre of the
body's equirect map, added to the spin term so texture features land
on their true longitudes. All shipped maps are centred on 0° except
Pluto (PIA11707 is centred on ~180°E — Sputnik Planitia at map
centre). Gas-giant and Venus cloud maps are epoch snapshots of
rotating cloud decks, so their longitude alignment is inherently
arbitrary; 0 is used.

`planet-labels.ts` draws per-planet body-anchored SVG labels above
the canvas. The label engine is independent of the chart-mode label
engine (`chart-labels.ts`); planet labels show when a planet system is
attached and the detail cycle permits `planetLabels` (floor `all`), and
are hidden in chart mode so the chart-mode glyph contract isn't doubled
up (`../scene/README.md` § Detail-level declutter cycle).

## Orbit rings

The orbit-ring layer (`orbit-rings-layer.ts`) draws each planet's
orbit as an ellipse with the host star at one focus. Geometry:
`b = a · √(1 − e²)`, focal offset `c = a · e`. The perihelion is placed
along the local +x axis as a placeholder; per-planet
longitude-of-perihelion landed alongside Standish elements in 3re.13.

Ring visibility is gated on an angular-separation heuristic so
distant host stars don't spam invisible rings into the framebuffer.
Orbit rings + the heliopause shell are also declutter-cycle elements
(floor `representational`) — `OrbitRingsLayer.setPermitted` /
`Heliopause.setPermitted` AND into `group.visible` alongside the existing
warp / chart / focus gates, so both hide at detail level `physical`
(`../scene/README.md`).

### Orbital plane convention

Per the 3re.8 design rule:

- **Sol's orbit rings sit on the ecliptic.** The host orientation
  quaternion rotates the local plane so +Z aligns with the ecliptic
  pole (J2000 obliquity ε = 23.4392911°). This matches what an
  observer at Sol sees on the sky.
- **All other host stars' orbit rings sit on the galactic plane.**
  Exoplanet system orientations are not generally known; aligning to
  the galactic plane gives a consistent visual "this star has
  planets" cue without implying a measured orientation we don't have.

The per-host quaternion is composed once at `getPlanetSystem` attach
time and reused for both the body positions and the ring renderer.
Ring renderer composes `Rz(Ω) · Rx(I) · Rz(ω)` per planet (from the
Sol-only `orbitOrientations` array, when present) before the
host-plane → ICRS rotation, so rings line up with the body positions
emitted by `positionsAt`.

## Heliopause boundary

`heliopause.ts` and the matching shaders. Asymmetric ellipsoid centred
on Sol, aligned to the interstellar-medium inflow — the direction the
heliosphere's nose points. Geometry is fixed (no `t` dependence on
human timescales):

- Upwind boundary at **122 AU** — Voyager 1 heliopause crossing,
  2012-08-25.
- Flank inferred at **~115 AU** from Voyager 2 heliopause crossing
  2018-11-05, combined with the apex-aligned ellipsoid model.
- Heliotail at **200 AU** — IBEX / Cassini ENA estimate.
- Nose (upwind apex) direction: the IBEX/Ulysses interstellar He
  inflow, J2000 ecliptic (λ, β) = (255.7°, 5.1°) ≈ ICRS RA 17h00m,
  Dec −17.6° (McComas et al. 2015, ApJS 220, 22). NOT the solar apex
  of motion vs nearby stars (RA 17h53m, Dec +27.4°), which sits ~47°
  away and once shipped here — the heliosphere is shaped by motion
  relative to the Local Interstellar Cloud. `sky-truth.test.ts` pins
  the direction and the ~30° Voyager 1 off-nose sanity check.

Construction: unit sphere → scale to (115, 115, 161) AU → translate
the centre 39 AU toward antiapex → rotate so +Z lands on the antiapex.
Result: upwind apex at +122 AU, downwind at −200 AU along the apex.

The shell, its label samples, and the hover picker all anchor on Sol,
whose renderer-local position is `-worldOffset` (Sol is the catalog
origin) — non-zero under planet focus. The group recentres via the
scene-layer `recenter` hook; the label engine and picker subtract the
live `worldOffset` from the exported Sol-anchored sample points
(`HELIOPAUSE_SAMPLE_POINTS_SOL`, `HELIOPAUSE_APEX_SOL_PC`).

Rendering uses a Fresnel limb-darkening fragment shader: alpha peaks
at the silhouette where the view ray grazes the surface and falls to
a small floor face-on, so the upwind apex region doesn't paint the
shell as a flat disc against the starfield. Back-face culling means
the shell disappears from inside (Sol focus, zoomed in) — this is
intentional, since from inside there's nothing geometrically
informative to show.

The "Heliopause" SVG label is anchored to the upwind apex's projected
silhouette by `createHeliopauseLabel` in `main.ts`. Visibility tracks
the same orbit-ring heuristic so the label disappears in lockstep
with the planet labels when the host system is too far for the
geometry to read.

## First-load default and `minDistance` relaxation

When the URL carries no view state, `first-load.ts` applies a
canonical `FIRST_LOAD_VIEW`: camera parked at exactly **5 AU** from
Sol aimed at the galactic centre, with the HUD ring on. Sol stays
the default focus; no constellation highlight is set so the bulge
shines through cleanly without an asterism layered over the brightest
patch of sky. The view is applied via `applyDecodedView` from
`url-state.ts` — the same pipeline used for `?v=` URL restores —
which keeps the "first interaction is the first URL write" contract
intact: `startUrlSync` seeds its frame-tracking baseline from the
live camera state on registration, so the URL stays empty until the
user actually moves the camera or changes a setting.

The Stellata constructor calls `setFocus(catalog.solIndex)` to
recentre the local frame on Sol but does not park the camera —
both bootstrap paths (`applyFirstLoadView` for the bare URL, and
`applyFromUrl` for `?v=` URLs) own the cam pose end-to-end and
run before first paint in `main.ts`.

Other arrival flows (warp, observe-exit, search-select) use
`minDistForStar` — only the bare-URL bootstrap reads
`first-load.ts`.

When focused on Sol, `controls.minDistance` drops to
`minOrbitDistForStar(Sol) ≈ 0.011 AU` so the user can fly into the
inner solar system and resolve individual planets. This is safe
specifically because Sol sits at the world origin — the float32
jitter that bites at small distances *from non-origin focal stars*
doesn't apply when the focal frame is also the world frame. Other
focal stars retain the global `0.005 pc` (~1031 AU) floor.

Focusing a planet body (`{kind:'planet'}` Targets — click, search,
URL) recentres the floating origin onto the planet itself and drops
the floor to `minOrbitDistForPlanet` (the same 90 %-fill angular
solve, ~2.4 body radii); arrival parks at `parkDistForPlanet` (a
30 %-fill solve). The camera follows the orbiting body via the
planet-focal ride — see `../camera/focus/README.md` § Planet focus.
A focused planet is a full observe anchor: entering observe parks the
camera on the body and hides it via `uHideIdx`
(`../camera/observe/README.md`).

`camera.near` is at `1e-10 pc` — well below `minOrbitDistForStar` —
so very-close planet inspection isn't culled. The strict-less-than
`camera.near < minDistance` invariant holds.

## Gotchas

- **Ecliptic ↔ equatorial obliquity.** Use J2000 ε = 23.4392911°
  consistently when composing the Sol-host quaternion. Do not reach
  for the time-varying obliquity term — Standish's accuracy budget
  doesn't need it and the apparent-position match is unaffected.
- **Ecliptic-pole sign.** The north ecliptic pole in ICRS is
  `(0, −sin ε, cos ε)` — RA 18h, Dec +66.56°; the y-component is
  NEGATIVE (cos 66.56° · sin 270° = −sin ε). The mirrored `+sin ε`
  pole once shipped, flipping every planet's declination by up to
  ~47°. `sky-truth.test.ts` pins the sign against JPL Horizons and
  solstice geometry — if it objects to your change, the change is
  wrong.
- **Variable-star pulsation is on `t`.** Pulsation phase reads the model
  clock (`uModelDays` from `getT()`) at real GCVS periods — no separate
  cosmetic clock. New render code that needs the pulsation phase reads
  `uModelDays` / `uModelDaysPerRealSec`, never wall-clock.
- **Per-focus minDistance override.** When focus switches *away*
  from Sol, the floor must snap back to `0.005 pc` *before* the new
  focus's recenter pulls the camera in. `setFocus` is the right hook
  and already handles this; any new focus path must as well.
- **Planet-system attach is async.** `getPlanetSystem` is a Promise
  even for Sol (which currently resolves synchronously). Don't assume the
  system is attached the same frame `setFocus` fires; the renderer
  handles `planetSystem === null` gracefully.
- **Heliopause label visibility.** Hidden when the camera is inside
  the shell or when the host is not Sol. Don't add a "show always"
  toggle without thinking through the dual gating.
- **Orbital plane rule for new hosts.** Any new planet-bearing host
  must declare its plane via the orientation quaternion. The default
  for non-Sol hosts is the galactic plane — don't accidentally
  default to the ecliptic.
