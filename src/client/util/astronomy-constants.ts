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

// Arcseconds → radians. π / (180 × 3600). Same magnitude as 1 / AU_PER_PC
// (1 AU subtends 1 arcsec at 1 pc by definition) but written out here so
// the unit conversion reads as the angular operation it is.
export const ARCSEC_TO_RAD = Math.PI / (180.0 * 3600.0);

// Julian Date of the J2000.0 epoch (2000 Jan 1.5 TT). Anchor for
// JD-offset wire formats and the JD ↔ Julian-year converter in stage 6.
export const J2000_JD = 2451545.0;

// Days in a Julian year (used by WDS year-of-observation → JD conversion).
export const DAYS_PER_JULIAN_YEAR = 365.25;
