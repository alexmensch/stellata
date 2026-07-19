// J2000 osculating orbital elements for the major moons + the resolver
// that composes their heliocentric ecliptic positions. Sibling of
// ephemeris.ts (planets). See src/client/solar-system/README.md § Moons.

import {
  J2000_JD,
  J2000_OBLIQUITY_RAD,
  KM_PC,
} from '../util/astronomy-constants';
import { orbitalStateToCartesian } from '../util/kepler-solver';
import type { Vec3 } from './ephemeris';
import { tToJDE } from './time';

const DEG = Math.PI / 180;
const COS_OBLIQUITY = Math.cos(J2000_OBLIQUITY_RAD);
const SIN_OBLIQUITY = Math.sin(J2000_OBLIQUITY_RAD);

export interface MoonElements {
  // Matches the moon's `Planet.name` and its `sol:<lowercase>` SID key.
  readonly name: string;
  // Parent planet's `Planet.name`. Position composition adds the moon's
  // parent-relative offset to the parent's heliocentric position.
  readonly parent: string;
  // Semi-major axis of the parent-relative orbit, km.
  readonly aKm: number;
  readonly e: number;
  // Inclination to the reference plane (deg). > 90 ⇒ retrograde (Triton).
  readonly incDeg: number;
  // Longitude of the ascending node Ω (deg), in the reference frame.
  readonly nodeDeg: number;
  // Argument of periapsis ω (deg).
  readonly periDeg: number;
  // Mean anomaly at the J2000 epoch (deg). Mean motion n = 360/periodDays
  // advances it: M(t) = m0Deg + n·(days past J2000).
  readonly m0Deg: number;
  // Sidereal orbital period, days.
  readonly periodDays: number;
  // ICRS RA/Dec (deg) of the reference-plane north pole — the Laplace /
  // equatorial pole JPL tabulates per satellite. The resolver builds the
  // Kepler offset in this plane, then rotates it to the ecliptic. Omitted
  // ⇒ the elements are already J2000-ecliptic (the Moon).
  readonly refPoleRaDeg?: number;
  readonly refPoleDecDeg?: number;
}

// Reference-plane poles shared across a parent's regular satellites: the
// inner Saturnians share one local Laplace plane; the Uranian regulars
// share Uranus's equatorial plane. Distant moons (Callisto, Titan,
// Iapetus) sit on their own tilted Laplace plane and carry it inline.
const SATURN_LAPLACE_POLE = { ra: 40.6, dec: 83.5 } as const;
const URANUS_EQUATOR_POLE = { ra: 257.311, dec: -15.175 } as const;

// Mean orbital elements from the JPL Solar System Dynamics satellite mean
// elements table (https://ssd.jpl.nasa.gov/sats/elem/), epoch J2000
// (2000-01-01.5 TDB). See docs/science-solar-system.md § Moons for the
// frame convention and per-moon reference plane.
export const MOON_ELEMENTS: readonly MoonElements[] = [
  // Earth — the Moon's orbit tracks the ecliptic, not Earth's equator, so
  // its elements are ecliptic-referenced (no refPole).
  {
    name: 'Moon', parent: 'Earth',
    aKm: 384400, e: 0.0554, incDeg: 5.16,
    nodeDeg: 125.08, periDeg: 318.15, m0Deg: 135.27, periodDays: 27.322,
  },

  // Jupiter — Galileans
  {
    name: 'Io', parent: 'Jupiter',
    aKm: 421800, e: 0.004, incDeg: 0.0,
    nodeDeg: 0.0, periDeg: 49.1, m0Deg: 330.9, periodDays: 1.769,
    refPoleRaDeg: 268.1, refPoleDecDeg: 64.5,
  },
  {
    name: 'Europa', parent: 'Jupiter',
    aKm: 671100, e: 0.009, incDeg: 0.5,
    nodeDeg: 184.0, periDeg: 45.0, m0Deg: 345.4, periodDays: 3.551,
    refPoleRaDeg: 268.1, refPoleDecDeg: 64.5,
  },
  {
    name: 'Ganymede', parent: 'Jupiter',
    aKm: 1070400, e: 0.001, incDeg: 0.2,
    nodeDeg: 58.5, periDeg: 198.3, m0Deg: 324.8, periodDays: 7.156,
    refPoleRaDeg: 268.2, refPoleDecDeg: 64.6,
  },
  {
    name: 'Callisto', parent: 'Jupiter',
    aKm: 1882700, e: 0.007, incDeg: 0.3,
    nodeDeg: 309.1, periDeg: 43.8, m0Deg: 87.4, periodDays: 16.690,
    refPoleRaDeg: 268.7, refPoleDecDeg: 64.8,
  },

  // Saturn
  {
    name: 'Mimas', parent: 'Saturn',
    aKm: 186000, e: 0.020, incDeg: 1.6,
    nodeDeg: 66.2, periDeg: 160.4, m0Deg: 275.3, periodDays: 0.942,
    refPoleRaDeg: SATURN_LAPLACE_POLE.ra, refPoleDecDeg: SATURN_LAPLACE_POLE.dec,
  },
  {
    name: 'Enceladus', parent: 'Saturn',
    aKm: 238400, e: 0.005, incDeg: 0.0,
    nodeDeg: 0.0, periDeg: 119.5, m0Deg: 57.0, periodDays: 1.370,
    refPoleRaDeg: SATURN_LAPLACE_POLE.ra, refPoleDecDeg: SATURN_LAPLACE_POLE.dec,
  },
  {
    name: 'Tethys', parent: 'Saturn',
    aKm: 295000, e: 0.001, incDeg: 1.1,
    nodeDeg: 273.0, periDeg: 335.3, m0Deg: 0.0, periodDays: 1.888,
    refPoleRaDeg: SATURN_LAPLACE_POLE.ra, refPoleDecDeg: SATURN_LAPLACE_POLE.dec,
  },
  {
    name: 'Dione', parent: 'Saturn',
    aKm: 377700, e: 0.002, incDeg: 0.0,
    nodeDeg: 0.0, periDeg: 116.0, m0Deg: 212.0, periodDays: 2.737,
    refPoleRaDeg: SATURN_LAPLACE_POLE.ra, refPoleDecDeg: SATURN_LAPLACE_POLE.dec,
  },
  {
    name: 'Rhea', parent: 'Saturn',
    aKm: 527200, e: 0.001, incDeg: 0.3,
    nodeDeg: 133.7, periDeg: 44.3, m0Deg: 31.5, periodDays: 4.518,
    refPoleRaDeg: SATURN_LAPLACE_POLE.ra, refPoleDecDeg: SATURN_LAPLACE_POLE.dec,
  },
  {
    name: 'Titan', parent: 'Saturn',
    aKm: 1221900, e: 0.029, incDeg: 0.3,
    nodeDeg: 78.6, periDeg: 78.3, m0Deg: 11.7, periodDays: 15.945,
    refPoleRaDeg: 36.4, refPoleDecDeg: 84.0,
  },
  {
    name: 'Iapetus', parent: 'Saturn',
    aKm: 3561700, e: 0.028, incDeg: 7.6,
    nodeDeg: 86.5, periDeg: 254.5, m0Deg: 74.8, periodDays: 79.331,
    refPoleRaDeg: 288.7, refPoleDecDeg: 78.9,
  },

  // Uranus
  {
    name: 'Miranda', parent: 'Uranus',
    aKm: 129846, e: 0.001, incDeg: 4.4,
    nodeDeg: 100.9, periDeg: 154.8, m0Deg: 73.0, periodDays: 1.413,
    refPoleRaDeg: URANUS_EQUATOR_POLE.ra, refPoleDecDeg: URANUS_EQUATOR_POLE.dec,
  },
  {
    name: 'Ariel', parent: 'Uranus',
    aKm: 190929, e: 0.001, incDeg: 0.0,
    nodeDeg: 0.0, periDeg: 9.6, m0Deg: 193.5, periodDays: 2.520,
    refPoleRaDeg: URANUS_EQUATOR_POLE.ra, refPoleDecDeg: URANUS_EQUATOR_POLE.dec,
  },
  {
    name: 'Umbriel', parent: 'Uranus',
    aKm: 265986, e: 0.004, incDeg: 0.1,
    nodeDeg: 174.8, periDeg: 183.4, m0Deg: 253.0, periodDays: 4.144,
    refPoleRaDeg: URANUS_EQUATOR_POLE.ra, refPoleDecDeg: URANUS_EQUATOR_POLE.dec,
  },
  {
    name: 'Titania', parent: 'Uranus',
    aKm: 436298, e: 0.002, incDeg: 0.1,
    nodeDeg: 29.5, periDeg: 184.0, m0Deg: 68.1, periodDays: 8.706,
    refPoleRaDeg: URANUS_EQUATOR_POLE.ra, refPoleDecDeg: URANUS_EQUATOR_POLE.dec,
  },
  {
    name: 'Oberon', parent: 'Uranus',
    aKm: 583511, e: 0.002, incDeg: 0.1,
    nodeDeg: 76.8, periDeg: 132.2, m0Deg: 143.6, periodDays: 13.463,
    refPoleRaDeg: URANUS_EQUATOR_POLE.ra, refPoleDecDeg: URANUS_EQUATOR_POLE.dec,
  },

  // Neptune
  {
    name: 'Triton', parent: 'Neptune',
    aKm: 354800, e: 0.000, incDeg: 157.3,
    nodeDeg: 178.1, periDeg: 0.0, m0Deg: 63.0, periodDays: 5.877,
    refPoleRaDeg: 299.8, refPoleDecDeg: 43.1,
  },
] as const;

// Moon mass as a fraction of the Earth–Moon total,
// m_moon/(m_earth+m_moon), from the IAU Moon:Earth mass ratio
// 0.0123000371. Standish's ephemeris gives the Earth–Moon barycentre;
// Earth's centre lies this fraction of the geocentric Moon vector back
// from the barycentre (~4700 km — sub-pixel at disc scale, resolvable at
// Earth-zoom).
export const MOON_MASS_FRACTION = 0.0123000371 / (1 + 0.0123000371);

/** Position of a moon relative to its parent's centre at Unix-seconds
 *  `t`, in **heliocentric-ecliptic-aligned parsecs** (parent-centred, but
 *  already rotated into the ecliptic axes so the caller adds it straight
 *  onto the parent's ecliptic position). Kepler solve in the moon's
 *  reference plane, then reference-plane → ecliptic. */
export function moonOffsetEcliptic(elem: MoonElements, t: number, out: Vec3): void {
  const days = tToJDE(t) - J2000_JD;
  const M = (elem.m0Deg + (360 / elem.periodDays) * days) * DEG;
  orbitalStateToCartesian(
    elem.aKm * KM_PC,
    elem.e,
    elem.incDeg * DEG,
    elem.nodeDeg * DEG,
    elem.periDeg * DEG,
    M,
    out,
  );

  // No reference pole ⇒ the elements are already J2000-ecliptic (the
  // Moon tracks the ecliptic, not Earth's equator). Rotating it by an
  // equatorial pole would tilt its orbit ~23° instead of the true ~5°.
  if (elem.refPoleRaDeg === undefined || elem.refPoleDecDeg === undefined) return;

  // Reference-plane → ICRS is Rz(α0+90°)·Rx(90°−δ0) — the IAU pole
  // convention, node measured from the reference plane's ascending node
  // on the ICRS equator. Then ICRS → ecliptic is Rx(−ε).
  const psi = (elem.refPoleRaDeg + 90) * DEG;
  const theta = (90 - elem.refPoleDecDeg) * DEG;
  const cosPsi = Math.cos(psi), sinPsi = Math.sin(psi);
  const cosTheta = Math.cos(theta), sinTheta = Math.sin(theta);

  const xr = out.x, yr = out.y, zr = out.z;
  const y1 = cosTheta * yr - sinTheta * zr;
  const z1 = sinTheta * yr + cosTheta * zr;
  const xi = cosPsi * xr - sinPsi * y1;
  const yi = sinPsi * xr + cosPsi * y1;

  out.x = xi;
  out.y = COS_OBLIQUITY * yi + SIN_OBLIQUITY * z1;
  out.z = -SIN_OBLIQUITY * yi + COS_OBLIQUITY * z1;
}

/** Split the Earth–Moon barycentre into Earth-centre and Moon positions.
 *  `bary` is the Standish EM-barycentre; `moonGeoOffset` is the Moon's
 *  geocentric offset from `moonOffsetEcliptic`. All vectors ecliptic pc. */
export function earthMoonSplit(
  bary: Readonly<Vec3>,
  moonGeoOffset: Readonly<Vec3>,
  outEarth: Vec3,
  outMoon: Vec3,
): void {
  const f = MOON_MASS_FRACTION;
  outEarth.x = bary.x - f * moonGeoOffset.x;
  outEarth.y = bary.y - f * moonGeoOffset.y;
  outEarth.z = bary.z - f * moonGeoOffset.z;
  outMoon.x = bary.x + (1 - f) * moonGeoOffset.x;
  outMoon.y = bary.y + (1 - f) * moonGeoOffset.y;
  outMoon.z = bary.z + (1 - f) * moonGeoOffset.z;
}
