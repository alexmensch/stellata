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
in `src/client/solar-system/ephemeris.ts` works directly from the
published JPL Table 2a/2b values — no external library, no network
fetch.

The full position chain (Standish ephemeris → ecliptic→ICRS rotation)
is pinned against external sky truth: geocentric RA/Dec for all nine
bodies plus the Sun at three fixed epochs, fetched once from the JPL
Horizons API (ephemeris DE441, retrieved 2026-07-02) and frozen in
`data/horizons/` (provenance + schema in that folder's README). The
regression corpus (`src/client/solar-system/sky-truth.test.ts`) holds
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
`src/client/solar-system/time.ts`) — the same window at which linear
star propagation and the static background layers stop being honest
(`docs/science-catalog-ingestion.md` § Current-epoch star positions).
No scrubbable epoch can leave the window, so no higher-precision
model is needed.

**Planet physical data.** Equatorial radii from NASA Planetary Fact
Sheets (https://nssdc.gsfc.nasa.gov/planetary/factsheet/). Semi-major
axes and eccentricities from JPL DE440 mean elements at J2000. Pluto
data from New Horizons 2015 reconnaissance (mean radius 1188 km,
tan-pink colour from MVIC imagery). Representative single-colour RGB
values per planet are observation-derived; pixel-accurate texturing,
banding, and atmospheric haloes are deferred until the renderer
exposes a planet-zoom affordance close enough for them to register.

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
and planet-body renderers (`src/client/solar-system/orbit-rings-layer.ts`
for the focus-only ring layer;
`src/client/solar-system/planet-body-field.ts` for the global,
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
label anchoring: see `src/client/solar-system/README.md` § Heliopause boundary.

Implementation: `src/client/solar-system/heliopause.ts` and
`src/client/solar-system/heliopause.{vert,frag}.glsl`.

