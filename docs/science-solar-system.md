# Solar system

Split out of `SCIENCE.md` § Solar system. Spans
`src/client/solar-system/`.

When a host star with planets is focused, Stellata renders the eight
planets, Pluto, faint orbit rings, and the heliopause boundary in the
local frame around the host. Sol is the only populated host so far; the
machinery is generic so future exoplanet-host work can plug in
without changing the renderer.

**Planet positions.** Heliocentric ecliptic positions are computed
from the **JPL Standish 1992 Keplerian-elements approximation**
(https://ssd.jpl.nasa.gov/planets/approx_pos.html), with the cubic
correction terms for Jupiter through Neptune that extend the validity
window to 3000 BC – 3000 AD at sub-arcminute accuracy. Implementation
in `src/client/solar-system/ephemerides/ephemeris.ts` works directly from the
published JPL Table 2a/2b values — no external library, no network
fetch.

The full position chain (Standish ephemeris → ecliptic→ICRS rotation)
is pinned against external sky truth: geocentric RA/Dec for all nine
bodies plus the Sun at three fixed epochs, fetched once from the JPL
Horizons API (ephemeris DE441, retrieved 2026-07-02) and frozen in
`data/horizons/` (provenance + schema in that folder's README). The
regression corpus (`src/client/solar-system/ephemerides/sky-truth.test.ts`) holds
every body within 0.5° of Horizons — the empirical worst case is
Saturn at 0.35°, a known Standish linear-elements residual near the
Jupiter–Saturn great inequality — and the Sun within 0.1°, including
solstice/equinox declination checks that would fail by ~47° on any
mirror-image error in the ecliptic→ICRS rotation.

VSOP87 was the originally-planned ephemeris model and would offer
sub-arcsecond accuracy ±4000 years from J2000. We dropped it during
implementation: planets render as billboarded discs at a pixel-size
floor, and sub-arcminute precision is invisible at every zoom the
user can reach. The Standish approximation is ~50 lines of code over
an 8-row element table, with no dependency cost. **Decision (closes
the deep-time question):** rather than adopting a heavier ephemeris,
the model clock itself clamps to the Standish validity window
(3000 BC – 3000 AD; `T_CLAMP_MIN_S`/`T_CLAMP_MAX_S` in
`src/client/solar-system/time/time.ts`) — the same window at which linear
star propagation and the static background layers stop being honest
(`docs/science-catalog-ingestion.md` § Current-epoch star positions).
No scrubbable epoch can leave the window, so no higher-precision
model is needed.

**Planet physical data.** Equatorial radii from NASA Planetary Fact
Sheets (https://nssdc.gsfc.nasa.gov/planetary/factsheet/). Semi-major
axes and eccentricities from JPL DE440 mean elements at J2000. Pluto
data from New Horizons 2015 reconnaissance (mean radius 1188 km,
tan-pink colour from MVIC imagery). Representative single-colour RGB
values per planet are observation-derived.

**Naked-eye colour calibration — reference white is the solar
spectrum.** The renderer's white point is sunlight, not D65: a body
reflecting the solar spectrum neutrally renders R = G = B. This is
the physically meaningful choice for a scene whose sole illuminant is
Sol — the eye white-balances to the ambient illuminant, and the star
pipeline's Ballesteros B−V mapping already places the Sun near
neutral. On top of that white point, each shipped surface map is
calibrated at build time so its sphere-weighted mean chromaticity
equals the body's **measured disc-integrated colour**: the adopted
B−V and V−Rc indices of Mallama, Krobusek & Pavlov 2017 (Icarus 282,
19, Table 3), expressed as flux ratios relative to the Sun's own
indices (B−V 0.653, V−Rc 0.352 — Ramírez et al. 2012 solar analogs)
and mapped onto the sRGB channels as B→blue, V→green, Rc→red (the
band/primary mismatch is second-order against the instrument-era
spread this removes). Per-map linear-RGB gains preserve mean
luminance, so only chromaticity moves. This replaces hand-tuned
per-map tint/desaturation judgement with measured targets, and the
corrections it makes are the known biases of the source imagery: the
Viking Mars mosaic's blue boost, the 1989 Voyager Neptune's
over-deep azure (Irwin et al. 2024), Venus's near-neutral white.
Machinery in `scripts/textures/texture_calibration.py`; per-body
numbers in the committed `data/textures/calibration.json`, pinned by
`scripts/textures/texture-calibration.test.ts`.

**Atmosphere shells.** Venus, Earth, Mars and Titan render a
scattering shell at their true visible atmosphere heights (90, 100,
60 and 300 km — Kármán-scale for Earth, haze tops for Venus, dust
haze for Mars, the detached haze layers for Titan), never
exaggerated. Two terms: a day-side limb glow from the analytic
optical path through the shell, and a Henyey-Greenstein forward-
scatter ring that appears as the phase angle approaches 180° — the
back-lit halo Cassini photographed at Titan and telescopes see at
Venus's inferior conjunction. Gas giants carry no shell: no detached
haze exists distinct from their cloud decks at render scale.
Implementation in `src/client/solar-system/atmosphere/README.md`.

**Moons.** The 18 major moons — Earth's Moon; Jupiter's Galileans (Io,
Europa, Ganymede, Callisto); Saturn's Mimas, Enceladus, Tethys, Dione,
Rhea, Titan, Iapetus; Uranus's Miranda, Ariel, Umbriel, Titania,
Oberon; and Neptune's Triton — carry J2000 osculating orbital elements
in `src/client/solar-system/ephemerides/moon-ephemeris.ts`, from two sources: the
Moon and the Galileans from the JPL Solar System Dynamics
planetary-satellite mean-elements table
(https://ssd.jpl.nasa.gov/sats/elem/); the Saturnians and Triton
re-derived from JPL Horizons osculating ecliptic elements at J2000
rotated into their reference planes, because the summary table's
node/ω/M triplets for those systems are not in the frame its legend
states (verified against Horizons state vectors). Sidereal periods are
stored at full published precision — a 1e-4 relative truncation puts
Io half an orbit off by 2026. Each moon's elements are
referred to the plane JPL tabulates them against, and that plane's
ICRS north pole is stored per moon so the resolver can rotate the
orbit into the ecliptic: the local **Laplace plane** for most (its
outward tilt for Callisto, Titan and Iapetus preserved rather than
collapsed onto the planet's equator), **Uranus's equatorial plane**
for the Uranian regulars, and — uniquely — the **ecliptic** for the
Moon, whose orbit tracks the ecliptic rather than Earth's equator (an
equatorial reference would swing its inclination 18°–29° over the
18.6-year nodal cycle). Triton is retrograde (i ≈ 157°). Node and
periapsis precession rates are dropped except where the Horizons
truth corpus showed them at on-sky-visible scale by 2026: Triton
carries its ~675-yr node precession about the Laplace pole, and Mimas
carries the ±43° / 71.8-yr Mimas–Tethys 4:2 resonance libration of
its mean longitude (both fitted to the corpus and consistent with
published values). Elsewhere the frozen-J2000 orientation reads
correctly over the model-clock window;
`src/client/solar-system/ephemerides/moon-sky-truth.test.ts` pins every moon's
geocentric parent-relative position angle and separation against
frozen Horizons truth at four epochs (data/horizons/). Mean radii from NASA/JPL fact sheets; geometric albedos span
the near-unity icy surfaces (Enceladus ≈ 0.99, Mimas ≈ 0.96) to the
dark carbonaceous ones (Callisto ≈ 0.22, Iapetus's leading hemisphere
far darker still), in `MOON_PHYSICAL` alongside representative colours.
Minor / irregular moons, Pluto's satellites, and moon ring systems are
out of scope. Parent gravitational parameters GM (Kepler III → a moon's
period) live on the parent `Planet` entries. The resolver
(`moonOffsetEcliptic`) Kepler-solves each moon in its reference plane
and rotates it into the ecliptic; `earthMoonSplit` divides Standish's
Earth–Moon barycentre into Earth-centre and Moon. Rendering, orbit
rings, and phase are layered on in later work.

**Planet rotation.** Per-body pole (RA/Dec, ICRS) and prime-meridian
angle `W(t) = W0 + Ẇ·d` from the IAU Working Group on Cartographic
Coordinates and Rotational Elements 2015 report (Archinal et al. 2018,
Celest Mech Dyn Astr 130:22, https://doi.org/10.1007/s10569-017-9805-5),
values as distributed in NAIF `pck00011.tpc`. Only the main linear
terms ship: the periodic nutation/precession corrections are sub-degree
(largest: Neptune's ±0.7° pole nod) and invisible at render scale,
while the linear pole rates keep the visually meaningful long-term
behaviour (Earth's axial precession moves the pole ~30° across the
model-clock window). `t` is treated as TDB — the ~69 s UTC↔TDB gap is
~0.3° of Earth spin, consistent with the Standish accuracy budget. The
regression corpus pins Earth's sub-solar longitude at an
equation-of-time zero crossing (Greenwich noon → ~0° lon).
Implementation: `src/client/solar-system/planets/rotation-elements-pure.ts`.

**Ring systems.** Each ringed body renders an annulus in its
equatorial (IAU-pole) plane textured by a 2048×1 radial strip.
Saturn (74,510→140,390 km) is coloured by Björn Jónsson's
Voyager/Cassini radial colour + transparency profiles; Uranus
(41,600→51,300 km, the 10 narrow main rings) and Neptune
(40,900→63,100 km, all five rings) are built from occultation +
Voyager 2 ring tables at **true opacity** — `1 − e^−τ`, box-averaged
so equivalent width is conserved — which makes them the barely-there
charcoal threads they really are (ring-particle albedo ~0.05).
Uranus's ε ring dominates and finally gives its ~98° obliquity a
visible cue; Neptune's Le Verrier and Adams rings (arcs folded in as
an azimuthal average) sit at 2–4/255 alpha, and the τ~10⁻⁴ Galle and
Lassell sheets quantise to zero. Jupiter's rings (τ ≤ 10⁻⁵) fall
three orders below the 8-bit floor and ship no strip at all —
scoping analysis in `data/textures/README.md` § Ring strips.
Lighting is a deliberately simple model:
full strip colour on the sunlit face, a dimmed transmitted factor on
the unlit face, both dying off as illumination goes edge-on to the
ring plane, and an analytic ray–ellipsoid planet-shadow test that
drops the occluded far-side segment to a residual floor. Phase-angle
brightening of the rings already reaches the *disc/glow* path through
the Mallama Saturn `c0` term; the resolved-mesh regime makes no
photometric claim beyond the above (in particular no forward-scatter
term, which is where Jupiter's dust rings would live).

**Earth night lights.** NASA Black Marble 2016 (Suomi NPP VIIRS)
blended in as an *emissive* term — no limb darkening, unlike the
reflected day texture — ramping in across a narrow band past the
geometric terminator. With rotation on the model clock, the hemisphere
showing its lights is the one actually dark at `t`.

**True-eclipse dimming.** A planet geometrically behind its host's
physical disc dims by the occluded area fraction (closed-form
circle-circle lens, the binaries eclipse-photometry math); a full
eclipse renders nothing at all — zero flux, quad collapsed — since
even a 7.5-mag residual is visible on a mag −1 Mercury behind Sol.
Glow through the host's perceptual halo
stays undimmed — the halo is a rendering artefact, not a surface. The
reverse transit (planet in front) would dim the host by (R_p/R_host)²
≲ 10⁻² mag and is deliberately not modelled.

**Planet geometric albedos** (V-band) from Mallama et al. 2018
(https://doi.org/10.1016/j.icarus.2017.05.018) and the NASA fact
sheets above: Mercury 0.142, Venus 0.689, Earth 0.434, Mars 0.170,
Jupiter 0.538, Saturn 0.499, Uranus 0.488, Neptune 0.442, Pluto 0.49
(HST + New Horizons reconnaissance). Drives the reflected-light
apparent magnitude formula in `src/client/solar-system/`.

**Planet phase functions.** Per-planet empirical V-band phase curves
from Mallama, Krobusek, Pavlov 2018, "Comprehensive wide-band
magnitudes and albedos for the planets, with applications to
exo-planets and Planet Nine" (Icarus 282, 2017, 19–33,
https://doi.org/10.1016/j.icarus.2016.09.023). Mercury,
Venus, Mars and Jupiter each carry a polynomial
`ΔV(α°) = c1·α + c2·α² + …` from the paper's Tables A-1.2, A-2.2,
A-4.2, A-5.2; Earth uses a cubic fit through the four discrete
values published in Table A-3.1; Saturn uses a static-β = 16°
approximation of the joint α/ring-tilt formula in Table A-6.2 (the
ring contribution lands as a constant `c0 = −0.55 mag` brightness
boost). The renderer multiplies the flux factor `10^(−ΔV/2.5)` into
the apparent-magnitude formula in place of the Lambertian default
whenever a planet carries coefficients and α is inside the published
validity bound. Mallama 2018 publishes no phase polynomial for
Uranus, Neptune or Pluto — the first two because their max α from
Earth is "negligible" (the paper models latitude/temporal effects
instead), Pluto because the paper doesn't cover it. Those three —
and every future exoplanet — fall back to the Lambertian phase
function `φ(α) = (sin α + (π − α)·cos α)/π`. See
`src/client/phase-function.ts` for the per-planet coefficients.

**Orbital plane orientation.** Sol's planet system is rendered in its
native ecliptic plane (J2000 obliquity ε = 23.4392911°), so the ring
layout matches what an observer at Sol sees on the sky. For all
*other* host stars (future exoplanets), ring planes default to the
galactic plane — exoplanet-system orientations are generally unknown,
and aligning to the galactic plane gives the user a consistent visual
cue that a focused star has planets without implying a measured
orientation we don't have. The per-host-plane →
ICRS rotation is composed once at attach and reused by the orbit-ring
and planet-body renderers (`src/client/solar-system/ephemerides/orbit-rings-layer.ts`
for the focus-only ring layer;
`src/client/solar-system/planets/planet-body-field.ts` for the global,
focus-independent body field). The rotation is anchored on the north
ecliptic pole in ICRS, `(0, −sin ε, cos ε)` — RA 18h, Dec +66.56°;
the y-component is negative.

**Time `t`.** All planet positions are evaluated at the model clock `t`
(Unix seconds, double) via `Stellata.getT()`, driven by the time-scrubber
widget; the bottom-right time readout displays the UTC timestamp the
positions correspond to. Every time-varying visual now shares this one
clock: planet ephemerides, binary orbital motion, the load-time
proper-motion advance (`docs/science-catalog-ingestion.md` §
Current-epoch star positions), AND variable-star
pulsation — the latter formerly rode a separate cosmetic `uTime`
real-seconds clock, now reversed so pulsation runs at real GCVS periods on
`t` and responds to the same time-warp.

Per-`t` cache granularity is 60 seconds: at billboarded-disc pixel
scale, sub-minute planet motion is invisible (Mercury moves ~3e-5 rad
seen from Earth in 60s ≈ 6″, well below pixel resolution at any
zoom). A future time-scrubber UI would plug in by overriding
`Stellata.setT()`.

**Heliopause boundary.** Modelled as an asymmetric ellipsoid centred
on Sol, aligned to the interstellar-medium inflow direction — the
heliosphere's shape is set by the Sun's motion relative to the Local
Interstellar Cloud, not by the solar apex of motion relative to
nearby stars. The cited measurements:

- Upwind boundary at **122 AU** — Voyager 1 heliopause crossing,
  2012-08-25.
- Flank inferred at **~115 AU** from Voyager 2 heliopause crossing
  2018-11-05, combined with the apex-aligned ellipsoid model.
- Heliotail at **200 AU** — IBEX / Cassini ENA observations.
- Nose (upwind apex) direction: the IBEX/Ulysses interstellar He
  inflow, J2000 ecliptic (λ, β) = (255.7°, 5.1°) ≈ ICRS RA 17h00m,
  Dec −17.6° — McComas et al. 2015, *ApJS* 220, 22,
  DOI 10.1088/0067-0049/220/2/22. (An earlier revision anchored the
  nose at the solar apex, RA 17h53m Dec +27.4° — ~47° off; Voyager 1's
  outbound direction sits ~30° from the corrected nose, consistent
  with its 122 AU crossing.)

The heliopause is **static on human timescales**. Solar-cycle
variations in the upwind distance are at the few-AU level across the
11-year cycle, well below the 122 AU upwind anchor; we don't animate
the boundary.

Construction details (sphere scale, offset, rotation), rendering, and
label anchoring: see `src/client/solar-system/heliopause/README.md`.

Implementation: `src/client/solar-system/heliopause/heliopause.ts` and
`src/client/fresnel-shell/fresnel-shell.{vert,frag}.glsl`.

