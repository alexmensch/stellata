// Earth's pole and prime meridian across the model clock, built from the
// long-term precession frames and the Earth rotation angle rather than
// from a linear IAU row. See README.md § Earth is not a linear row.

import { ARCSEC_TO_RAD, J2000_JD } from '../../../util/astronomy-constants';
import {
  longTermEquatorPole,
  longTermEquinox,
} from '../../../util/precession';
import { tToJDE, tToJdTdb } from '../../time/time';

const DEG = Math.PI / 180;
const DAYS_PER_JULIAN_CENTURY = 36525;

// Earth rotation angle (IERS): a strictly linear function of UT1, which
// is what makes it the right carrier for Earth's non-uniform spin — all
// of the non-uniformity lives in ΔT, on the other side of the clock.
const ERA_AT_J2000_REV = 0.7790572732640;
const ERA_REV_PER_UT1_DAY = 1.00273781191135448;

// Accumulated precession of the equinox in right ascension (IAU 2006),
// arcsec per Julian century of TT. This is the whole difference between
// sidereal time and the Earth rotation angle: the equinox slides along
// the equator while the planet turns.
const GMST_MINUS_ERA_ARCSEC = [
  0.014506, 4612.156534, 1.3915817, -0.00000044, -0.000029956, -0.0000000368,
];

function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Earth's pole (deg, ICRS) at model time `t`, from the long-term
 *  precession model. The pole is a dynamical quantity, so its argument
 *  is TT — unlike the spin below. */
export function earthPoleRaDecDeg(t: number): { raDeg: number; decDeg: number } {
  const p = longTermEquatorPole(tToJdTdb(t));
  return {
    raDeg: (Math.atan2(p.y, p.x) / DEG + 360) % 360,
    decDeg: Math.asin(Math.max(-1, Math.min(1, p.z))) / DEG,
  };
}

/** Greenwich mean sidereal time (deg) — the right ascension of date of
 *  the Greenwich meridian. ERA carries the rotation, the polynomial
 *  carries the equinox's own motion along the equator. */
export function greenwichSiderealDeg(t: number): number {
  const era = 360 * (ERA_AT_J2000_REV
    + ERA_REV_PER_UT1_DAY * (tToJDE(t) - J2000_JD));
  const T = (tToJdTdb(t) - J2000_JD) / DAYS_PER_JULIAN_CENTURY;
  let arcsec = 0;
  for (let i = GMST_MINUS_ERA_ARCSEC.length - 1; i >= 0; i--) {
    arcsec = arcsec * T + GMST_MINUS_ERA_ARCSEC[i];
  }
  return era + (arcsec * ARCSEC_TO_RAD) / DEG;
}

/**
 * Earth's prime-meridian angle W (deg) in the IAU sense — measured in the
 * equator of date from its ascending node on the ICRS equator.
 *
 * Sidereal time is measured from the **equinox** of date instead, so the
 * two differ by the node→equinox arc, which is what a linear W row cannot
 * carry: over the model clock that arc sweeps tens of degrees, and not at
 * a constant rate.
 */
export function earthSpinDeg(t: number): number {
  const jdTt = tToJdTdb(t);
  const pole = longTermEquatorPole(jdTt);
  const equinox = longTermEquinox(jdTt);
  // Ascending node of the equator of date on the ICRS equator, at ICRS
  // right ascension α0 + 90°.
  const raPole = Math.atan2(pole.y, pole.x);
  const node = { x: -Math.sin(raPole), y: Math.cos(raPole), z: 0 };
  const cross = {
    x: node.y * equinox.z - node.z * equinox.y,
    y: node.z * equinox.x - node.x * equinox.z,
    z: node.x * equinox.y - node.y * equinox.x,
  };
  const nodeToEquinoxDeg = Math.atan2(dot(cross, pole), dot(node, equinox)) / DEG;
  return nodeToEquinoxDeg + greenwichSiderealDeg(t);
}
