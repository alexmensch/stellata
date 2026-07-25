// J2000 osculating orbital elements for the major moons + the resolver
// that composes their heliocentric ecliptic positions. Sibling of
// ephemeris.ts (planets). See src/client/solar-system/README.md § Moons.

import {
  J2000_JD,
  J2000_OBLIQUITY_RAD,
  KM_PC,
} from '../../util/astronomy-constants';
import { orbitalStateToCartesian } from '../../util/kepler-solver';
import type { Vec3 } from './ephemeris';
import { tToJDE } from '../time/time';

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
  // Sidereal orbital period, days — FULL published precision, never
  // rounded: phase error grows as 360°·(Δn/n)·(days/period), so a
  // 1e-4 relative truncation puts Io ~half an orbit off by 2026.
  // moon-sky-truth.test.ts pins every moon against JPL Horizons.
  readonly periodDays: number;
  // ICRS RA/Dec (deg) of the reference-plane north pole — the Laplace /
  // equatorial pole JPL tabulates per satellite. The resolver builds the
  // Kepler offset in this plane, then rotates it to the ecliptic. Omitted
  // ⇒ the elements are already J2000-ecliptic (the Moon).
  readonly refPoleRaDeg?: number;
  readonly refPoleDecDeg?: number;
  // Secular node precession (deg/day, + = advancing). The resolver
  // compensates M by −rate·cos(i)·d so the tabulated sidereal
  // periodDays keeps governing the fixed-frame mean longitude.
  readonly nodeDegPerDay?: number;
  // Resonance libration of the mean longitude (Mimas–Tethys 4:2),
  // applied to M differentially against its J2000 snapshot:
  // ΔM = amp·(sin(phase0 + 360·d/period) − sin(phase0)).
  readonly libAmpDeg?: number;
  readonly libPeriodDays?: number;
  readonly libPhaseDeg?: number;
}

// Reference-plane poles shared across a parent's regular satellites: the
// inner Saturnians share one local Laplace plane; the Uranian regulars
// share Uranus's equatorial plane. Distant moons (Callisto, Titan,
// Iapetus) sit on their own tilted Laplace plane and carry it inline.
const SATURN_LAPLACE_POLE = { ra: 40.6, dec: 83.5 } as const;
// The ORBIT-NORMAL pole of the Uranian equatorial plane — the frame
// the JPL mean elements are prograde in. This is the ANTIPODE of the
// IAU spin pole (257.311, -15.175): Uranus spins retrograde about its
// IAU north, so composing the elements about the IAU pole mirrors
// every orbit (moon-sky-truth.test.ts caught exactly that).
const URANUS_EQUATOR_POLE = { ra: 77.311, dec: 15.175 } as const;

// J2000 (2000-01-01.5 TDB) elements, two sources: the Moon + Galileans
// from the JPL SSD satellite mean-elements table
// (https://ssd.jpl.nasa.gov/sats/elem/); the Saturnians and Triton
// re-derived from Horizons osculating ecliptic elements at J2000
// rotated into each stored reference plane — the summary table's
// node/ω/M triplets for those systems are not in the frame its legend
// states and put every moon tens of degrees off (verified against
// Horizons state vectors; moon-sky-truth.test.ts pins the corpus).
// See docs/science-solar-system.md § Moons for the frame convention
// and per-moon reference plane.
export const MOON_ELEMENTS: readonly MoonElements[] = [
  // Earth — the Moon's orbit tracks the ecliptic, not Earth's equator, so
  // its elements are ecliptic-referenced (no refPole).
  {
    name: 'Moon', parent: 'Earth',
    aKm: 384400, e: 0.0554, incDeg: 5.16,
    nodeDeg: 125.08, periDeg: 318.15, m0Deg: 135.27, periodDays: 27.321661,
  },

  // Jupiter — Galileans
  {
    name: 'Io', parent: 'Jupiter',
    aKm: 421800, e: 0.004, incDeg: 0.0,
    nodeDeg: 0.0, periDeg: 49.1, m0Deg: 330.9, periodDays: 1.769137786,
    refPoleRaDeg: 268.1, refPoleDecDeg: 64.5,
  },
  {
    name: 'Europa', parent: 'Jupiter',
    aKm: 671100, e: 0.009, incDeg: 0.5,
    nodeDeg: 184.0, periDeg: 45.0, m0Deg: 345.4, periodDays: 3.551181,
    refPoleRaDeg: 268.1, refPoleDecDeg: 64.5,
  },
  {
    name: 'Ganymede', parent: 'Jupiter',
    aKm: 1070400, e: 0.001, incDeg: 0.2,
    nodeDeg: 58.5, periDeg: 198.3, m0Deg: 324.8, periodDays: 7.154553,
    refPoleRaDeg: 268.2, refPoleDecDeg: 64.6,
  },
  {
    name: 'Callisto', parent: 'Jupiter',
    aKm: 1882700, e: 0.007, incDeg: 0.3,
    nodeDeg: 309.1, periDeg: 43.8, m0Deg: 87.4, periodDays: 16.689017,
    refPoleRaDeg: 268.7, refPoleDecDeg: 64.8,
  },

  // Saturn
  {
    name: 'Mimas', parent: 'Saturn',
    aKm: 186000, e: 0.021756, incDeg: 1.6074,
    nodeDeg: 173.1916, periDeg: 337.7315, m0Deg: 37.3981, periodDays: 0.9424218,
    refPoleRaDeg: SATURN_LAPLACE_POLE.ra, refPoleDecDeg: SATURN_LAPLACE_POLE.dec,
    // Mimas–Tethys 4:2 resonance: mean longitude librates ±43° over
    // ~71.8 yr; amplitude/phase fitted to the Horizons corpus (the
    // fitted 43° matches the published 43.4°).
    libAmpDeg: 43, libPeriodDays: 26228.6, libPhaseDeg: 140,
  },
  {
    name: 'Enceladus', parent: 'Saturn',
    aKm: 238400, e: 0.006352, incDeg: 0.0321,
    nodeDeg: 196.09, periDeg: 339.3291, m0Deg: 6.9534, periodDays: 1.3702186,
    refPoleRaDeg: SATURN_LAPLACE_POLE.ra, refPoleDecDeg: SATURN_LAPLACE_POLE.dec,
  },
  {
    name: 'Tethys', parent: 'Saturn',
    aKm: 295000, e: 0.00097, incDeg: 1.1015,
    nodeDeg: 257.8752, periDeg: 298.7815, m0Deg: 350.3828, periodDays: 1.8878026,
    refPoleRaDeg: SATURN_LAPLACE_POLE.ra, refPoleDecDeg: SATURN_LAPLACE_POLE.dec,
  },
  {
    name: 'Dione', parent: 'Saturn',
    aKm: 377700, e: 0.002928, incDeg: 0.0402,
    nodeDeg: 225.8602, periDeg: 338.9793, m0Deg: 332.0566, periodDays: 2.7369152,
    refPoleRaDeg: SATURN_LAPLACE_POLE.ra, refPoleDecDeg: SATURN_LAPLACE_POLE.dec,
  },
  {
    name: 'Rhea', parent: 'Saturn',
    aKm: 527200, e: 0.0008, incDeg: 0.2831,
    nodeDeg: 344.1179, periDeg: 221.1395, m0Deg: 206.9021, periodDays: 4.5175028,
    refPoleRaDeg: SATURN_LAPLACE_POLE.ra, refPoleDecDeg: SATURN_LAPLACE_POLE.dec,
  },
  {
    name: 'Titan', parent: 'Saturn',
    aKm: 1221900, e: 0.028601, incDeg: 0.3314,
    nodeDeg: 25.4029, periDeg: 182.8806, m0Deg: 163.4362, periodDays: 15.9454484,
    refPoleRaDeg: 36.4, refPoleDecDeg: 84.0,
  },
  {
    name: 'Iapetus', parent: 'Saturn',
    aKm: 3561700, e: 0.027862, incDeg: 7.524,
    nodeDeg: 74.6282, periDeg: 277.5909, m0Deg: 208.0176, periodDays: 79.3301825,
    refPoleRaDeg: 288.7, refPoleDecDeg: 78.9,
  },

  // Uranus
  {
    name: 'Miranda', parent: 'Uranus',
    aKm: 129846, e: 0.001, incDeg: 4.4,
    nodeDeg: 100.9, periDeg: 154.8, m0Deg: 73.0, periodDays: 1.4134794,
    refPoleRaDeg: URANUS_EQUATOR_POLE.ra, refPoleDecDeg: URANUS_EQUATOR_POLE.dec,
  },
  {
    name: 'Ariel', parent: 'Uranus',
    aKm: 190929, e: 0.001, incDeg: 0.0,
    nodeDeg: 0.0, periDeg: 9.6, m0Deg: 193.5, periodDays: 2.5203787,
    refPoleRaDeg: URANUS_EQUATOR_POLE.ra, refPoleDecDeg: URANUS_EQUATOR_POLE.dec,
  },
  {
    name: 'Umbriel', parent: 'Uranus',
    aKm: 265986, e: 0.004, incDeg: 0.1,
    nodeDeg: 174.8, periDeg: 183.4, m0Deg: 253.0, periodDays: 4.1441772,
    refPoleRaDeg: URANUS_EQUATOR_POLE.ra, refPoleDecDeg: URANUS_EQUATOR_POLE.dec,
  },
  {
    name: 'Titania', parent: 'Uranus',
    aKm: 436298, e: 0.002, incDeg: 0.1,
    nodeDeg: 29.5, periDeg: 184.0, m0Deg: 68.1, periodDays: 8.7058717,
    refPoleRaDeg: URANUS_EQUATOR_POLE.ra, refPoleDecDeg: URANUS_EQUATOR_POLE.dec,
  },
  {
    name: 'Oberon', parent: 'Uranus',
    aKm: 583511, e: 0.002, incDeg: 0.1,
    nodeDeg: 76.8, periDeg: 132.2, m0Deg: 143.6, periodDays: 13.4632389,
    refPoleRaDeg: URANUS_EQUATOR_POLE.ra, refPoleDecDeg: URANUS_EQUATOR_POLE.dec,
  },

  // Neptune
  {
    name: 'Triton', parent: 'Neptune',
    aKm: 354800, e: 0.000146, incDeg: 157.1725,
    nodeDeg: 176.7718, periDeg: 74.2731, m0Deg: 343.4607, periodDays: 5.8768541,
    refPoleRaDeg: 299.8, refPoleDecDeg: 43.1,
    // Node precession about the Laplace pole, fitted to the Horizons
    // corpus (+0.00146°/day ≈ 675-yr period vs the published ~688 yr).
    nodeDegPerDay: 0.00146,
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
  const nodeRate = elem.nodeDegPerDay ?? 0;
  let mDeg = elem.m0Deg
    + (360 / elem.periodDays - nodeRate * Math.cos(elem.incDeg * DEG)) * days;
  if (elem.libAmpDeg !== undefined) {
    const ph0 = (elem.libPhaseDeg ?? 0) * DEG;
    mDeg += elem.libAmpDeg
      * (Math.sin(ph0 + (2 * Math.PI * days) / elem.libPeriodDays!) - Math.sin(ph0));
  }
  orbitalStateToCartesian(
    elem.aKm * KM_PC,
    elem.e,
    elem.incDeg * DEG,
    (elem.nodeDeg + nodeRate * days) * DEG,
    elem.periDeg * DEG,
    mDeg * DEG,
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
