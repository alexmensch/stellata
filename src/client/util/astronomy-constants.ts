// Canonical astronomical constants. One definition per quantity; consumers
// (client modules, build scripts, tests, shaders via uniform) import from
// here so they can't silently drift apart on precision or value.

// 1 parsec in AU and its reciprocal. IAU 2015 parsec definition: 1 pc =
// 648000/π AU = 206264.80624709636 AU exactly. AU_PC is the float64
// reciprocal so callers can multiply a value-in-AU by AU_PC to get parsecs.
export const AU_PER_PC = 206264.80624709636;
export const AU_PC = 1 / AU_PER_PC;

// 1 AU in kilometres (IAU 2012 exact value).
export const AU_KM = 1.495978707e8;

// 1 km in parsecs. Used to convert physical body radii (catalogued in km)
// into scene units.
export const KM_PC = AU_PC / AU_KM;

// 1 solar radius in parsecs.
//   1 R_sun = 6.957e8 m, 1 pc = 3.0857e16 m  →  R_sun = 2.2543e-8 pc.
// Also uploaded to the star vertex shader as the `uRSunPc` uniform.
export const R_SUN_PC = 2.2543e-8;

// Absolute V-band magnitude of the Sun (IAU / Willmer 2018). Anchors the
// host-irradiance reference in perceptual-magnitude.ts so reflected-light
// surface brightness scales with the host star's luminosity class rather
// than assuming solar output — a body 1 AU from an O star is far brighter
// than one 1 AU from Sol.
export const SUN_ABSMAG_V = 4.83;

// Floor on a catalog `physicalRadius[idx]` (in solar radii) before
// converting to parsecs (`* R_SUN_PC`). Keeps R > 0 in geometric formulas
// that divide by it or take its log.
export const MIN_PHYSICAL_RADIUS_R_SUN = 1e-9;

// Arcseconds → radians. π / (180 × 3600). Same magnitude as 1 / AU_PER_PC
// (1 AU subtends 1 arcsec at 1 pc by definition) but written out here so
// the unit conversion reads as the angular operation it is.
export const ARCSEC_TO_RAD = Math.PI / (180.0 * 3600.0);

// Julian Date of the J2000.0 epoch (2000 Jan 1.5 TT). Anchor for
// JD-offset wire formats and the JD ↔ Julian-year converter in stage 6.
export const J2000_JD = 2451545.0;

// J2000 obliquity of the ecliptic (IAU) — the tilt between the ICRS
// equatorial and ecliptic planes, about the +X (vernal equinox) axis.
// Single source so every ecliptic↔equatorial rotation (planet ephemeris
// chain, orbit-ring plane, moon reference-frame composition) uses the
// identical value; the Standish accuracy budget does not need the
// time-varying obliquity term.
export const J2000_OBLIQUITY_RAD = (23.4392911 * Math.PI) / 180;

// Days in a Julian year (used by WDS year-of-observation → JD conversion).
export const DAYS_PER_JULIAN_YEAR = 365.25;

// Right ascension in hours → degrees. Catalogue RA columns (AT-HYG's `ra`)
// and sexagesimal `hh:mm:ss` boundary coordinates both arrive in hours;
// everything downstream of the parse works in degrees.
export const RA_HOURS_TO_DEG = 15;

// Light travel time over one AU, seconds (IAU 2009). Two consumers: the
// light-time correction any comparison against an observer-frame astrometric
// position needs (0.03° at Mercury), and the probe card's signal round-trip.
export const LIGHT_TIME_PER_AU_S = 499.004783836;
