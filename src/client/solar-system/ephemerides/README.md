# Ephemerides and orbit rings

Position resolvers for planets and moons, the parent/orbit descriptor the
focus card reads, the orbit-ring layer, and the frozen JPL Horizons truth
corpora that pin the whole chain. Positions come out as heliocentric
**ecliptic** parsecs; the rotation onto ICRS happens in the caller via the
per-host orbital-plane quaternion.

## Files in this area

```
src/client/solar-system/ephemerides/
  lunar-theory-pure.ts            Truncated ELP-2000/82 (Meeus ch. 47):
                                  the Moon's λ/β/Δ in the mean ecliptic
                                  and equinox of date. See § Moon
                                  ephemeris.
  moon-vector-truth.test.ts       The theory + precession chain vs frozen
                                  Horizons geocentric vectors spanning
                                  the whole clock, plus Meeus's own
                                  worked example 47.a.
  ephemeris.ts (+ test)           The two element sources and the seam
                                  between them: JPL Standish 1992
                                  Keplerian elements + cubic Jupiter–Pluto
                                  correction terms, plus the frozen
                                  Horizons tables where they reach.
                                  Heliocentric ecliptic parsecs out.
  equinoctial-pure.ts (+ test)    The non-singular element representation
                                  every source is expressed in, and the
                                  blend. See § Equinoctial elements.
  element-table.ts (+ test)       One planet's uniform-cadence table of
                                  equinoctial elements + the Catmull–Rom
                                  sampler. See § Horizons element tables.
  element-table-loader.ts         Parallel fetch of the nine tables from
                                  public/ephemerides/. A missing file
                                  drops that planet onto Standish; it is
                                  never an error.
  moon-ephemeris.ts (+ test)      MOON_ELEMENTS — J2000 osculating orbital
                                  elements for the 18 major moons, each
                                  with its reference-plane pole — plus the
                                  resolver (moonOffsetEcliptic,
                                  earthMoonSplit) and the Moon's series
                                  path (moonGeocentricKm,
                                  moonOsculatingOrbit).
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
                                  Horizons state vectors: both element
                                  sources, the seam between them, and the
                                  only epochs in the suite that reach the
                                  clock's clamp bounds. Epochs are JD TDB,
                                  so neither the clock nor a frame
                                  rotation enters.
  moon-sky-truth.test.ts          Moon half of the corpus: every major
                                  moon's parent-relative on-sky position
                                  angle + separation vs Horizons at four
                                  epochs — catches orbital-phase drift
                                  (truncated mean motions, wrong frames).
```

## Planet ephemeris

`ephemeris.ts` positions the nine planets from **two element sources**,
picked by epoch:

- **Frozen Horizons element tables** across 1900–2100, ~5e-6 AU
  (§ Horizons element tables).
- **The JPL Standish 1992 Keplerian-elements approximation** with the
  cubic Jupiter–Pluto correction terms (Table 2a/2b inlined) everywhere
  else — the whole 3000 BC – 3000 AD span the model clock clamps to
  (`../time/README.md`).

Both are evaluated into equinoctial elements and go through one
`orbitalStateToCartesian`; there is no second Kepler solve and no second
element-to-position path. `getPlanetPositions` and
`getPlanetOrbitShapes` read the *same* evaluation, so a ring cannot
drift off its body — including through the seam.

### The Standish series is not sub-arcminute, and its error is not invisible

Standish's published budget for the Table 2a elements
(`ssd.jpl.nasa.gov/planets/approx_pos.html` § Accuracy) reaches
λ 1000″ / ρ 4.0e6 km at Saturn and λ 2000″ / ρ 8.0e6 km at Uranus;
measured against DE441 the giants sit at 0.05–0.14 AU across the clamp
and 0.05 AU in 1900–2100. Whether that shows depends on viewing
distance, not on eye discrimination from Sol (CLAUDE.md § Camera-anywhere, any-epoch):
under a Voyager 2 flythrough the camera rides within the true 0.0007 AU
Uranus approach while the series puts the planet 0.05 AU away, so the
swing-by reads as a distant pass. That is what the tables are for, and it
is why they cover only the epochs a mission actually happened in.

Pluto's row is the pre-removal Table 2a one **plus** its Table 2b `b`
term. The widely reproduced linear-elements row is Standish's Table 1
(1800–2050) — it holds 0.016 AU near now but grows quadratically to
~25 AU at the clamp bound, on the wrong side of the orbit, and the
model clock reaches there.

VSOP87 was rejected as a runtime dependency: ~500 KB of coefficients
plus a new solver, for accuracy a frozen table gets more cheaply.

## Horizons element tables

`data/ephemerides/{planet}.json` — one uniform-cadence table of
osculating elements per planet across 1900–2100. Provenance, units and
the measured per-planet accuracy are in
`../../../../data/ephemerides/README.md`; the fetch pipeline is
`../../../../scripts/ephemerides/README.md`. What matters on this side:

- **Lazy, and not on the critical path.** `main.ts` fires
  `loadPlanetElementTables` without awaiting it. 1.5 MB behind first
  paint would buy nothing: the first frame is Sol-focused, where the
  outer planets the tables move are sub-pixel discs. Until it lands,
  every planet is on Standish and the scene is simply the old one.
- **A missing artifact is not an error.** A checkout that never ran the
  `public/` sync gets nine null table slots and the series everywhere.
- **`installPlanetElementTables` resets the per-`t` cache.** The swap
  moves the outer planets by up to 0.05 AU; a live cache entry would
  hold the pre-table position for the rest of the frame it landed in.
- **Sampling is Catmull–Rom, float64, indexed by arithmetic.** The
  cadence is uniform, so there is no search and no cursor to invalidate
  when a scrub jumps decades between frames. The reasons for cubic over
  linear and for extrapolating the boundary control point are measured
  and live in `element-table.ts`.

### The seam

The two models disagree by up to 0.05 AU at the window edges, so the
table's weight ramps over **one Julian year** at each end instead of
switching. Under planet focus a hard switch would pop, and the ramp is a
labelled interpolation between two published models — not a tuned
constant.

Blending happens in **element** space, not position space. That is what
keeps rings on their bodies through the seam: one evaluation feeds both,
so there is no way for a blended position and an unblended ring to
disagree. `vector-truth.test.ts` pins continuity at both edges and the
monotone ramp between them.

## Equinoctial elements

`equinoctial-pure.ts` is the representation both sources are expressed
in: `h/k` = `e·(sin ϖ, cos ϖ)`, `p/q` = `tan(i/2)·(sin Ω, cos Ω)`, and
the mean longitude λ = M + ϖ.

**This is not a stylistic choice — the classical set is singular for
bodies in this system.** The Earth/Moon barycentre's osculating
inclination to the ecliptic of J2000 passes through 0.0001°, and across
one Horizons sample its Ω jumps 215° while the orbit does not move at
all. Interpolating Ω and ω separately — in the tables or in the seam
blend — puts Earth on the wrong side of the Sun.

The cost is one convention: `equinoctialToClassical` returns the
canonical `i ≥ 0` form, so a **negative tabulated inclination comes back
as `(|i|, Ω + 180°, ω + 180°)`**. That is the same rotation
(`Rz(π)·Rx(i)·Rz(π) = Rx(−i)`), so positions and rings are unaffected —
but Standish's EM Bary row carries `I = −0.00054346°`, and a test reading
`getPlanetOrbitShapes(...).orientation.longAscNode` back for Earth sees
the shifted pair, not the table's. `ephemeris.test.ts` pins exactly
that.

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

### The Moon runs on a series, not on its element row

Earth's Moon is the one satellite **not** positioned by a Kepler solve.
`lunar-theory-pure.ts` is the truncated ELP-2000/82 series (Meeus,
*Astronomical Algorithms* 2nd ed., ch. 47): 60 longitude / 60 latitude /
46 distance periodic terms over the five fundamental arguments, returning
λ, β, Δ in the **mean ecliptic and equinox of date**.

A fixed ellipse cannot place an eclipse. The real ascending node
regresses 0.0529°/day (18.6 yr) and the apse advances ~40.7°/yr, so by
2026 the J2000 element row put the node line ~25° out — eclipse seasons
slid by ~25 days and the Moon's shadow missed Earth at every real solar
eclipse. Secular rates alone would not have fixed it either: evection
(1.27°) and variation (0.66°) are each many Earth radii of shadow
displacement on their own.

The row stays in `MOON_ELEMENTS` behind `useLunarTheory`, as the mean
orbit that the focus card's orbit descriptor and the tidally-locked
rotation parity read. **It is not the position source**, and the orbit
ring does not read it either — see § Orbit rings.

Frame: the series is referred to the equinox of date, and the model works
in the J2000 ecliptic. Over the clock's span the equinox sweeps ~42° and
the ecliptic plane itself moves ~0.5°, so the conversion is a full
three-angle rotation, not a longitude offset —
`../../util/precession.ts`'s Vondrák long-term model supplies it.
Nutation is deliberately omitted: mean-of-date → mean-of-J2000 is exactly
the precession-only chain, and the Sun's position carries no nutation
either, so the pair stays consistent.

### Mean-longitude recalibration

ELP-2000/82 was fitted over a few centuries around J2000. Measured
against DE441 across the model clock, its error is **entirely
along-track**: latitude holds to 62″ and distance to 42 km at the bounds,
while longitude drifts to +518″ (≈1000 km) by 3000 BC — a full umbra
width of eclipse-path displacement and ~17 minutes of timing.

The series' mean longitude therefore carries a T²/T³ recalibration,
least-squared over the 134 irregularly-spaced Horizons epochs tagged
`fit` in `data/horizons/moon-vector-truth.tsv`. It is the same kind of
correction Espenak's eclipse canons apply for the lunar tidal
acceleration, and the same kind of measured fit Triton's node rate and
Mimas's libration amplitude already carry in `MOON_ELEMENTS`. Deeper
polynomials do not help — T⁴ raises the worst residual — because what
remains is the truncation floor. Latitude gets no such term: a secular
fit moves its worst case only from 62″ to 58″.

Resulting geocentric accuracy vs Horizons/DE441, pinned in
`moon-vector-truth.test.ts`: **≲12 km across 1900–2100, ≲20 km over the
independent `check` grid, ≲150 km at the clamp bounds** (was ~1000 km
before the recalibration, and tens of thousands from the element row).

### Every other moon

Orbital elements (`moon-ephemeris.ts`) are J2000 osculating, each
referred to the plane JPL tabulates it against, with that plane's ICRS
pole stored per moon (`refPoleRaDeg`/`refPoleDecDeg`): the local
Laplace plane for most, Uranus's equator for the Uranian regulars
(the ORBIT-NORMAL pole — the antipode of the retrograde IAU spin
pole; composing about the IAU pole mirrors every Uranian orbit), and
the ecliptic for the Moon (no pole — the Moon tracks the ecliptic,
not Earth's equator). Sidereal periods carry full published precision
(a truncated mean motion scrambles phase within years), Triton models
its slow node precession — which its **ring** reads too, via the shared
`keplerMoonAnglesAt`; taking the static `nodeDeg` there left the ring 14°
off Triton's actual orbit by the present day — and Mimas carries the
Mimas–Tethys resonance libration — `moon-sky-truth.test.ts` pins all of it against
frozen Horizons truth, including a present-day epoch where phase
drift is at its most visible.

`moonOffsetEcliptic(elem, t, out)` is the resolver for both paths — it
branches to the series on `useLunarTheory` and otherwise runs a Kepler solve in
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
elements for planets, `MOON_ELEMENTS` for moons, and for **the Moon**
the osculating ellipse through the lunar theory's own state, via
`moonOsculatingOrbit` — its element row would leave the ring behind the
body within a single month), never the
display-only `Planet.semiMajorAxisAu`/`.eccentricity` fields. The two
tables were once unreconciled and rings visibly missed their bodies.
Geometry — **every DRAWN ring, host-centred and parent-centred alike** —
is checked against the live elements every frame and
rewritten only when they have drifted past `RING_GEOMETRY_DRIFT_TOLERANCE`
— **the polyline's own resolution**, so a skipped rewrite is provably
invisible. Moon rings were once excluded from that refresh entirely, on
the reasoning that moon elements carry no secular terms; that holds for
the 17 Kepler moons and not for Earth's Moon, whose ring froze at attach
time and drifted up to 19 000 km — 5 % of its distance — off the body.
The drift gate, not the body kind, is what keeps the refresh cheap: a
Kepler moon fails it on five float compares and is never rewritten.

**Two gates, in this order: visibility, then drift.** `update` decides
what is on screen first and `refreshGeometry` runs only over the
survivors — with every ring sub-pixel it does not evaluate the elements
at all, which for Sol is three lunar-theory evaluations and their
precession frames saved per frame. Skipping while invisible is only safe
because catching up is not deferred: a ring flipping visible is
rewritten and rebaked in that same frame, pinned both ways in
`orbit-rings-layer.test.ts`. Evaluating nine sets of elements is the cheap half (and shares
`getPlanetOrbitShapes`' per-`t` cache with the body positions); rewriting
8192 vertices and re-uploading the buffer is what costs. Keying the rewrite
on elapsed *sim* time is what this replaced, and it had no rate limit at
all: one frame at high fast-forward advances decades, so it degenerated
into a full nine-ring re-derive every frame. Ring orientation still tracks
secular drift under scrubbing, and there is no attach-time wall-clock
snapshot. Hosts without an
element source fall back to `defaultOrbitGeometry` (static a/e, flat
on the host plane).

### The polyline starts a vertex on the body

`buildEllipsePoints`' loop parameter IS the eccentric anomaly, so
`BodyOrbitGeometry.eccentricAnomaly` — the body's own E at this `t`, from
the same evaluation that positions it — makes vertex 0 land exactly on
the body.

Without it a body lies on the true ellipse while the ring is an inscribed
N-gon that falls up to `a·(π/N)²/2` inside it: **429 km at Pluto, a third
of its radius**. That offset cycles 0 → max → 0 as the body crosses each
vertex, which reads as the ring drifting while the planet is held in
focus. Anchored, it is identically zero, and the ring near the body is a
chord that departs from the true ellipse only quadratically in distance
away from it — 2 km at 5000 km out, sub-pixel at any framing.

Anchoring only helps while it is fresh, so `ringGeometryDrifted` carries a
phase leg with its own, much looser `RING_PHASE_ANCHOR_TOLERANCE`. It asks
a different question from the other five — not "has the ellipse moved"
(it has not) but "has the body run off its vertex" — and sharing the shape
tolerance would rewrite every ring every frame.

**Vertex count is not the lever it looks like.** Anchoring removes the
offset at the body but not the chord sag away from it, which grows as
N⁻²: at N = 512 the ring visibly lifts off the true path within a few
thousand km of a focused body. 8192 stays.

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

- **Ecliptic ↔ equatorial obliquity.** Don't open-code it a fifth time:
  `../../util/ecliptic-frame.ts` is the one scalar `Rx(±ε)` pair, and
  `orbit-rings-layer.ts`'s `refPlaneToEclipticQuat` the one quaternion
  form. Use J2000 ε = 23.4392911° consistently when composing the
  Sol-host quaternion, and do not reach for the time-varying obliquity
  term — Standish's accuracy budget doesn't need it and the
  apparent-position match is unaffected. (The lunar theory's
  equinox-of-date frame is a different question and does move — see
  § Moon ephemeris.)
- **Ecliptic-pole sign.** The north ecliptic pole in ICRS is
  `(0, −sin ε, cos ε)` — RA 18h, Dec +66.56°; the y-component is
  NEGATIVE (cos 66.56° · sin 270° = −sin ε). The mirrored `+sin ε`
  pole once shipped, flipping every planet's declination by up to
  ~47°. `sky-truth.test.ts` pins the sign against JPL Horizons and
  solstice geometry — if it objects to your change, the change is
  wrong.
