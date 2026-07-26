# Ephemerides and orbit rings

Position resolvers for planets and moons, the parent/orbit descriptor the
focus card reads, the orbit-ring layer, and the frozen JPL Horizons truth
corpora that pin the whole chain. Positions come out as heliocentric
**ecliptic** parsecs; the rotation onto ICRS happens in the caller via the
per-host orbital-plane quaternion.

## Files in this area

```
src/client/solar-system/ephemerides/
  ephemeris.ts (+ test)           JPL Standish 1992 Keplerian-elements
                                  approximation + cubic Jupiter–Neptune
                                  correction terms. Heliocentric ecliptic
                                  parsecs out.
  moon-ephemeris.ts (+ test)      MOON_ELEMENTS — J2000 osculating orbital
                                  elements for the 18 major moons, each
                                  with its reference-plane pole — plus the
                                  resolver (moonOffsetEcliptic,
                                  earthMoonSplit).
  orbit-descriptor.ts (+ test)    Parent/orbit descriptor for the focus
                                  card — every body's breadcrumb, orbit
                                  distance, and period from its parent
                                  (planet ← host star, solar mass; moon ←
                                  parent planet, parent GM). Pure; no
                                  solar-mass assumption. Also exports
                                  parentIndexOf, the shared
                                  parent-by-name resolution.
  orbit-rings-layer.ts (+ test)   Faint orbit rings: host-centred planet
                                  rings + parent-centred moon rings, built
                                  from the system's live element source.
                                  Also exports ECLIPTIC_NORTH_POLE_ICRS.
  sky-truth.test.ts               Regression corpus: the ephemeris →
                                  ecliptic→ICRS chain vs JPL Horizons
                                  RA/Dec frozen in data/horizons/, plus
                                  solstice/equinox mirror detectors.
  vector-truth.test.ts            Heliocentric ecliptic positions vs frozen
                                  Horizons state vectors at deep epochs
                                  outside the clock's populated window —
                                  the only corpus that reaches the clamp
                                  bounds. Epochs are JD TDB fed straight to
                                  the element evaluation, so neither the
                                  clock nor a frame rotation enters.
  moon-sky-truth.test.ts          Moon half of the corpus: every major
                                  moon's parent-relative on-sky position
                                  angle + separation vs Horizons at four
                                  epochs — catches orbital-phase drift
                                  (truncated mean motions, wrong frames).
```

## Planet ephemeris

`ephemeris.ts` implements the **JPL Standish 1992 Keplerian-elements
approximation** with the cubic Jupiter–Pluto correction terms
(Table 2a/2b inlined), valid over the whole 3000 BC – 3000 AD span the
model clock clamps to (`../time/README.md`).

**It is not sub-arcminute, and the error is not invisible.** Standish's
published budget for the Table 2a elements
(`ssd.jpl.nasa.gov/planets/approx_pos.html` § Accuracy) reaches
λ 1000″ / ρ 4.0e6 km at Saturn and λ 2000″ / ρ 8.0e6 km at Uranus;
measured against DE441 the giants sit at 0.05–0.14 AU across the clamp
and 0.05–0.06 AU in 1900–2100. Whether that shows depends on viewing
distance, not on eye discrimination from Sol (CLAUDE.md § Camera-anywhere):
at Uranus focus the camera stands well inside 0.06 AU of the planet.
`vector-truth.test.ts` holds each body to that published budget at both
clamp bounds.

Pluto's row is the pre-removal Table 2a one **plus** its Table 2b `b`
term. The widely reproduced linear-elements row is Standish's Table 1
(1800–2050) — it holds 0.016 AU near now but grows quadratically to
~25 AU at the clamp bound, on the wrong side of the orbit, and the
model clock reaches there.

VSOP87 was rejected as a runtime dependency: ~500 KB of coefficients
plus a new solver, for accuracy a frozen table gets more cheaply.

Returned positions are heliocentric **ecliptic** parsecs, not ICRS —
the rotation onto ICRS happens in the caller via the per-host
orbital-plane orientation quaternion. Sol's quaternion is the J2000
obliquity rotation; future exoplanet hosts (`bk5`) get a galactic-
plane-aligned default per § Orbital plane convention.

Positions recompute at every distinct `t` — the single-slot cache is
keyed on exact `t` and only collapses the several same-frame consumers
(body field, focal ride, overlays) into one Kepler solve per frame.
The former 60-second bucket was reasoned against billboarded-disc
pixel scale ("sub-minute motion is invisible"); mesh-LOD close viewing
invalidated that premise — a resolved disc visibly snapped position
once a minute — so the bucket is gone. Nine Kepler solves per frame is
noise next to the 18 moon solves that already ran unbucketed.

## Moon ephemeris

Orbital elements (`moon-ephemeris.ts`) are J2000 osculating, each
referred to the plane JPL tabulates it against, with that plane's ICRS
pole stored per moon (`refPoleRaDeg`/`refPoleDecDeg`): the local
Laplace plane for most, Uranus's equator for the Uranian regulars
(the ORBIT-NORMAL pole — the antipode of the retrograde IAU spin
pole; composing about the IAU pole mirrors every Uranian orbit), and
the ecliptic for the Moon (no pole — the Moon tracks the ecliptic,
not Earth's equator). Sidereal periods carry full published precision
(a truncated mean motion scrambles phase within years), Triton models
its slow node precession, and Mimas carries the Mimas–Tethys
resonance libration — `moon-sky-truth.test.ts` pins all of it against
frozen Horizons truth, including a present-day epoch where phase
drift is at its most visible.

`moonOffsetEcliptic(elem, t, out)` is the resolver: a Kepler solve in
the moon's reference plane (shared `orbitalStateToCartesian` core with
the planet ephemeris), then reference-plane → ICRS `Rz(α0+90°)·Rx(90°−δ0)`
(IAU pole convention — node from the plane's ascending node on the ICRS
equator) → ecliptic `Rx(−ε)`, so the result adds straight onto the
parent's ecliptic position. The Moon skips the rotation (already
ecliptic). `earthMoonSplit` then divides Standish's EM-barycentre into
Earth-centre and Moon by `MOON_MASS_FRACTION` (Earth ~4700 km
off-barycentre, resolvable at Earth-zoom).

`solPositionsAt` calls the resolver each frame: after the nine planet
positions it appends `parent_ecliptic + moonOffsetEcliptic` per moon,
and jointly resolves the Earth slot + Moon slot from the Standish
EM-barycentre via `earthMoonSplit`. The single ecliptic→ICRS host
quaternion the field already applies then rotates the whole vector, so
the offset composes in the ecliptic frame here and lands at
parent+offset in ICRS.

## Orbit rings

The orbit-ring layer (`orbit-rings-layer.ts`) draws every body's orbit
as an ellipse with its centre body at one focus — the host star for a
planet, the parent planet for a moon (the moon ring rides its parent's
live host-relative offset each frame and lies on the moon's tabulated
reference plane, rotated to the ecliptic by the same pole convention
the moon resolver applies — parity vitest-pinned).

**Geometry comes from `PlanetSystem.orbitGeometryAt(t)` — the SAME
element source that positions the bodies** (Sol: live Standish
elements for planets, `MOON_ELEMENTS` for moons), never the
display-only `Planet.semiMajorAxisAu`/`.eccentricity` fields. The two
tables were once unreconciled and rings visibly missed their bodies.
Host-centred geometry re-derives whenever its build `t` ages past
`RING_GEOMETRY_MAX_AGE_S` (one sim-day), so time scrubbing keeps ring
orientation locked to the secular element drift the body positions
follow; there is no attach-time wall-clock snapshot. Hosts without an
element source fall back to `defaultOrbitGeometry` (static a/e, flat
on the host plane).

Geometry rebuilds whenever the focused star's PlanetSystem changes; a
per-frame tick drives the pixel-gap visibility heuristic.
Representational only — rings hide when the host loses focus. Each ring
rides its live centre (the host's renderer-local position, fed each
frame from `PlanetBodyField.getHostLocalPositionInto`) through the
anchored-line scheme in `../../util/orbit-line.ts`: float64
centre-relative master verts, float32 GPU buffer baked renderer-local
and rebaked on centre drift — under planet focus the floating origin
sits on the planet, the host is NOT at the local origin, and
centre-relative float32 verts would jitter by hundreds of km under
camera motion. The pixel-gap heuristic measures camera-to-host distance.

Ring visibility is gated on an angular-separation heuristic so
distant host stars don't spam invisible rings into the framebuffer.
The pixel-gap test runs per centre body (host rings gap against each
other; each parent's moon rings form their own group measured at the
parent's camera distance), and every ring additionally needs its own
radius above the threshold — the floor that suppresses a lone
sub-pixel ring, e.g. a single-moon parent seen from across the system.
Orbit rings + the heliopause shell are also declutter-cycle elements
(floor `representational`) — `OrbitRingsLayer.setPermitted` /
`Heliopause.setPermitted` AND into `group.visible` alongside the existing
warp / chart / focus gates, so both hide at detail level `physical`
(`../../scene/README.md`).

## Orbital plane convention

- **Sol's orbit rings sit on the ecliptic.** The host orientation
  quaternion rotates the local plane so +Z aligns with the ecliptic
  pole (J2000 obliquity ε = 23.4392911°). This matches what an
  observer at Sol sees on the sky.
- **All other host stars' orbit rings sit on the galactic plane.**
  Exoplanet system orientations are not generally known; aligning to
  the galactic plane gives a consistent visual "this star has
  planets" cue without implying a measured orientation we don't have.

The per-host quaternion is composed once at attach time and reused for
both the body positions and the ring renderer. The ring renderer
composes `Rz(Ω) · Rx(I) · Rz(ω)` per body from `orbitGeometryAt(t)`
(plus the reference-plane → ecliptic rotation for a moon) before the
host-plane → ICRS rotation, so rings line up with the body positions
emitted by `positionsAt`.

Any new planet-bearing host must declare its plane via the orientation
quaternion; the default for non-Sol hosts is the galactic plane — don't
accidentally default to the ecliptic.

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
