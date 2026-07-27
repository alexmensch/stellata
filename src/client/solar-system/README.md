# Solar-system layer

When a focusable star carries a planet system, Stellata renders the
planets as lit spheroid meshes (with a reflected-glare billboard) at
their heliocentric positions, faint orbit rings on the host's orbital
plane, and (Sol only) the heliopause boundary as a translucent
asymmetric shell. Sol is the only populated host so far; the framework
is deliberately generic so the future exoplanet epic (`stellata-bk5`)
can plug in without changing the renderer.

This folder owns the **system contract** — what a planet system is,
which bodies exist, their SIDs, the reflected-light magnitude model
every renderer shares, and the local-depth activation decision.
Rendering, ephemerides, and the clock live in the subfolders.

## Subfolders

- `planets/` — the two render layers (instanced glare field + close-range
  spheroid mesh LOD), shaders, rotation elements, inter-body shadows,
  per-body labels.
- `atmosphere/` — first-principles single-scattering airlight for Venus,
  Earth, Mars, and Titan; the integrator and its CPU mirror.
- `time/` — simulation time `t`, the `VirtualClock` behind
  `Stellata.getT()`, the UTC readout, and the transport scrubber widget.
- `ephemerides/` — planet + moon position resolvers (frozen JPL Horizons
  element tables across 1900–2100, the Standish series outside them),
  orbit-descriptor breadcrumbs, the orbit-ring layer, and the frozen
  Horizons truth corpora.
- `heliopause/` — Sol's heliopause boundary shell.
- `probes/` — the five Sun-escape deep-space probes: trajectory sampler,
  fixed-size markers, traversed trails, labels, and the `probe` focus
  kind's geometry. Sol-anchored and ICRS throughout — deliberately not
  funnelled through the planets' ecliptic-local pipeline or their
  reflected-light magnitude model.

## Files in this area

```
src/client/solar-system/
  planet-system.ts                Planet / PlanetSystem contract.
                                  hasPlanets + getPlanetSystem; SOL_PLANETS
                                  table (eight majors + Pluto) + SOL_MOONS
                                  table (18 major moons) + the SOL_BODIES
                                  concatenation. Also carries the
                                  PlanetAtmosphere rows (atmosphere/README.md).
  sol-object-sids.ts              SOL_OBJECT_SIDS — hand-written key →
                                  frozen Stellata ID pins (Sun + planets +
                                  moons + probes). See § Sol-system SID
                                  pins.
  planet-system-membership.ts     Planet-system implementation of the
                                  kind-generic system-membership contract
                                  (../system-membership/README.md), one
                                  hierarchy level per target: host →
                                  planets, planet → its moons, over
                                  PlanetBodyField.isCollapsedOntoParent
                                  verdicts. Covers exoplanet hosts as
                                  soon as bk5 attaches them.
  perceptual-magnitude.ts         Per-planet apparent-magnitude model
                                  (Lambertian + Mallama phase factors)
                                  + hostIntensityScale (mesh-regime
                                  host-irradiance lighting).
                                  Drives the body field's glare
                                  sizing/brightness and per-planet label
                                  gating. Also consumed by ../binaries/
                                  and ../camera/controls/ for stars.
  phase-function.ts (+ test)      Lambertian + Mallama phase functions
                                  + phaseRatioToLambert (mesh phase
                                  scalar). Pure helpers.
  local-cluster.ts                SolarSystemCluster — per-frame local-
                                  depth-pass membership + bracket
                                  spheres; owns the "system is locally
                                  active" decision. See
                                  ../local-depth/README.md.
  local-cluster-pure.ts (+ test)  Activation predicate + orbit-ring
                                  extent radius, pure. Vitest-pinned.
  first-load.ts (+ test)          Canonical no-URL first-load view: 5 AU
                                  galactic-centre-aimed park.
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
  optional `positionsAt(t, out)` resolver writing 3 doubles per planet
  in the host's local orbital-plane frame, optional
  `orbitGeometryAt(t)` (live per-body ring geometry) for the
  orbit-ring renderer.

Sync probe: `hasPlanets(catalog, idx)` — currently hardwires "planets ⇔ Sol".
Async resolver: `getPlanetSystem(catalog, idx)` returns the system or
`null`. The Promise wrapper is intentional so `bk5` can lazily fetch
per-host JSON shards without changing the call sites.

`SOL_PLANETS` is the eight major planets + Pluto with constants
sourced from NASA Planetary Fact Sheets (radii) and JPL DE440 (mean
elements at J2000). Pluto comes from New Horizons 2015 reconnaissance.
See `docs/science-solar-system.md` §Solar system for the citation rationale.

### Bodies: planets and moons are one array

`SOL_MOONS` is the 18 major moons as `Planet` entries: Earth's Moon;
the four Galileans; seven Saturnian moons; five Uranian moons; and
Triton. Physical props (`MOON_PHYSICAL`) live next to `SOL_PLANETS`;
orbital `a`/`e` are read from `MOON_ELEMENTS`
(`ephemerides/moon-ephemeris.ts`) by name so they have a single source
of truth. Scope + citations in `docs/science-solar-system.md` § Moons.

`SOL_MOONS` is **not** part of `SOL_PLANETS`; the two concatenate into
`SOL_BODIES` (the nine planets then the 18 moons), which is what
`getPlanetSystem` returns as `planets`. The body field, mesh layer, and
every interaction contract iterate that one array, so a moon inherits
Target / focus / click / POI / hover / search as an ordinary body — no
moon-specific path. `solPositionsAt` writes positions in `SOL_BODIES`
order (planets first). Every moon carries IAU rotation elements
(`MOON_ROTATION_BY_NAME` in `planets/rotation-elements-pure.ts`) —
tidally locked, so each `Ẇ` equals the orbital mean motion (test-pinned
against `MOON_ELEMENTS`) and the same face keeps toward the parent.

## Sol-system SID pins

`sol-object-sids.ts` maps each Sol-system object that carries no catalog
record or artifact of its own — `sun`, `mercury` … `pluto`, the 18 moons
`moon`, `io` … `triton`, and the five probes `pioneer10` …
`newhorizons` — to its frozen Stellata ID (docs/sid.md § 7). This
hand-written table is their runtime SID source, feeding two resolver
domains: `planet` (moons reuse the `planet` kind — a moon is a
planet-domain object under the resolver) and `probe` (`kind=probe` in
the ledger, keyed on the mission roster id). The values are frozen
ledger sids minted from `data/sid/sol-objects.tsv`;
`sol-object-sids.test.ts` imports the ledger and asserts each entry
matches (tests import, never redefine), covers exactly the mint list,
pins a sid for every `SOL_BODIES` runtime body and every
`PROBE_MISSIONS` entry, and asserts the probe rows carry ledger kind
`probe` rather than `planet`. `sol:sun` rides the Sol **catalog** record
via a same-as edge, so that record's in-record sid and
`SOL_OBJECT_SIDS.sun` are the same integer by construction.

## Reflected-light magnitude model

`perceptual-magnitude.ts` + `phase-function.ts` are the CPU side of the
shared reflected-light model; `planets/planet.vert.glsl` carries the
GPU mirror. Both must stay in step — the pure helpers are vitest-pinned
and the full-Moon calibration (−12.7) anchors the underlying flux.

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
without published curves. Mallama covers Mercury, Venus, Earth, Mars,
Jupiter and Saturn; Uranus, Neptune, Pluto and every exoplanet take the
Lambertian fallback, since Mallama 2018 publishes no phase-angle
polynomial for those. Verified Jupiter values (under Lambert):
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

## Local activation

`local-cluster.ts` (`SolarSystemCluster`) owns the per-frame "this
system is locally active" decision and the bracket spheres that define
the local depth pass's near/far range. While active, the planet
layers collapse their main-pass instances and render through the
mirror draw inside the bracketed pass, where the mesh writes depth —
see `../local-depth/README.md` and `planets/README.md` § Planet mesh LOD.
The probe marker field and trail layer follow the same flip
(`probes/README.md` § Which pass draws them); everything a body could
occlude has to be inside the pass, because the pass clears depth.
The activation predicate and the orbit-ring extent radius are pure and
vitest-pinned in `local-cluster-pure.ts`; `RING_EXTENT_MARGIN` is also
read by `../binaries/binary-orbit-path-layer.ts`.

## First-load default and `minDistance` relaxation

When the URL carries no view state, `first-load.ts` applies a
canonical `FIRST_LOAD_VIEW`: camera parked at exactly **5 AU** from
Sol aimed at the galactic centre, with the HUD ring on. Sol stays
the default focus; no constellation highlight is set so the bulge
shines through cleanly without an asterism layered over the brightest
patch of sky. The view carries **no `up` override** — the reference
axis stays at galactic north, so first paint is galactic-level. The view is applied via `applyDecodedView` from
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
moving-focal ride — see `../camera/focus/README.md` § Hard kinds.
A focused planet is a full observe anchor: entering observe parks the
camera on the body and hides it via `uHideIdx`
(`../camera/observe/README.md`).

Focusing a probe (`{kind:'probe'}` Targets) is the third hard kind and
takes the same shape, with fixed park / floor distances in place of the
angular solves and the same ride carrying the camera along the whole
trajectory under scrub — `probes/README.md` § Focus.

`camera.near` is at `1e-12 pc` — well below `minOrbitDistForStar` and
below the tightest planet/moon floor (`minOrbitDistForPlanet` for a
small moon like Mimas ≈ 1.5e-11 pc) — so very-close planet and moon
inspection isn't culled. The strict-less-than `camera.near < minDistance`
invariant holds; the earlier `1e-10 pc` value clipped every sub-Pluto
moon at its park distance.

## Gotchas

- **Per-focus minDistance override.** When focus switches *away*
  from Sol, the floor must snap back to `0.005 pc` *before* the new
  focus's recenter pulls the camera in. `setFocus` is the right hook
  and already handles this; any new focus path must as well.
- **Planet-system attach is async.** `getPlanetSystem` is a Promise
  even for Sol (which currently resolves synchronously). Don't assume the
  system is attached the same frame `setFocus` fires; the renderer
  handles `planetSystem === null` gracefully.
- **Orbital plane rule for new hosts.** Any new planet-bearing host
  must declare its plane via the orientation quaternion. The default
  for non-Sol hosts is the galactic plane — don't accidentally
  default to the ecliptic. See `ephemerides/README.md`
  § Orbital plane convention.
- **Variable-star pulsation is on `t`.** Pulsation phase reads the model
  clock (`uModelDays` from `getT()`) at real GCVS periods — no separate
  cosmetic clock. New render code that needs the pulsation phase reads
  `uModelDays` / `uModelDaysPerRealSec`, never wall-clock. See
  `time/README.md`.
