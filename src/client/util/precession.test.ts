import { describe, expect, it } from 'vitest';

import { ARCSEC_TO_RAD, J2000_JD } from './astronomy-constants';
import { unitVectorFromRaDec } from './equatorial-basis';
import {
  B1875_JD,
  besselianEpochToJd,
  longTermEclipticPole,
  longTermEclipticRotationFromJ2000,
  longTermEquatorPole,
  longTermEquatorRotationFromJ2000,
  precessDirection,
  precessRaDec,
  precessionAnglesFromJ2000,
  precessionRotationFromJ2000,
  unprecessDirection,
  unprecessRaDec,
} from './precession';

const B1875 = precessionRotationFromJ2000(B1875_JD);

const CORPUS = [
  { name: 'Betelgeuse', raDeg: 88.79293899, decDeg: 7.40706400 },
  { name: 'Sirius', raDeg: 101.28715533, decDeg: -16.71611586 },
  { name: 'Vega', raDeg: 279.23473479, decDeg: 38.78368896 },
  { name: 'rho Aql', raDeg: 303.5692452, decDeg: 15.19760993 },
  { name: 'Achernar', raDeg: 24.42852995, decDeg: -57.23675748 },
];

describe('Besselian epochs', () => {
  it('anchors on B1900.0', () => {
    expect(besselianEpochToJd(1900)).toBe(2415020.31352);
  });

  it('puts B1875.0 at the end of 1874', () => {
    expect(B1875_JD).toBeCloseTo(2405889.2586, 4);
    // JD 2405889.5 is 1875 Jan 1.0 UT.
    expect(B1875_JD).toBeLessThan(2405889.5);
    expect(B1875_JD).toBeGreaterThan(2405888.5);
  });
});

describe('IAU 1976 precession angles', () => {
  it('vanish at J2000', () => {
    const { zetaRad, zRad, thetaRad } = precessionAnglesFromJ2000(J2000_JD);
    expect(zetaRad).toBe(0);
    expect(zRad).toBe(0);
    expect(thetaRad).toBe(0);
  });

  it('run backwards for an epoch before J2000', () => {
    const { zetaRad, zRad, thetaRad } = precessionAnglesFromJ2000(B1875_JD);
    expect(zetaRad).toBeLessThan(0);
    expect(zRad).toBeLessThan(0);
    expect(thetaRad).toBeLessThan(0);
    // θ is the pole's own displacement — 2004.31″ per century, so ~0.7° over
    // the 1.25 centuries back to B1875.
    expect(thetaRad / ARCSEC_TO_RAD).toBeCloseTo(-2505.9456, 3);
  });
});

describe('precession rotation', () => {
  it('is orthonormal with unit determinant', () => {
    const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = B1875;
    const rows = [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]];
    for (const row of rows) {
      expect(Math.hypot(...row)).toBeCloseTo(1, 12);
    }
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
      const dot = rows[a].reduce((sum, v, i) => sum + v * rows[b][i], 0);
      expect(dot).toBeCloseTo(0, 12);
    }
    const det = m00 * (m11 * m22 - m12 * m21)
      - m01 * (m10 * m22 - m12 * m20)
      + m02 * (m10 * m21 - m11 * m20);
    expect(det).toBeCloseTo(1, 12);
  });

  it('is the identity at J2000', () => {
    const at = unitVectorFromRaDec(123.4, -45.6);
    const moved = precessDirection(precessionRotationFromJ2000(J2000_JD), at);
    expect(moved.x).toBeCloseTo(at.x, 15);
    expect(moved.y).toBeCloseTo(at.y, 15);
    expect(moved.z).toBeCloseTo(at.z, 15);
  });

  it('round-trips every corpus position through B1875 and back', () => {
    for (const star of CORPUS) {
      const back = unprecessRaDec(B1875, precessRaDec(B1875, star));
      expect(back.raDeg).toBeCloseTo(star.raDeg, 10);
      expect(back.decDeg).toBeCloseTo(star.decDeg, 10);
    }
  });

  it('inverts the rotation exactly', () => {
    const at = unitVectorFromRaDec(303.5692452, 15.19760993);
    const back = unprecessDirection(B1875, precessDirection(B1875, at));
    expect(back.x).toBeCloseTo(at.x, 15);
    expect(back.y).toBeCloseTo(at.y, 15);
    expect(back.z).toBeCloseTo(at.z, 15);
  });
});

// The closed-form annual rates dα/dt = m + n·sinα·tanδ and dδ/dt = n·cosα
// integrate to the same displacement the matrix composition produces. They
// share the IAU 1976 constants, so this pins the composition (rotation order
// and the θ sign, which a flip moves a full 2θ ≈ 1.4° in dec) rather than the
// underlying model. Second-order drift over 125 years — the rates themselves
// change as α and δ move — keeps this at arcminute tolerance; the flipped-θ
// error is 60× larger.
describe('matrix composition vs the closed-form precession rates', () => {
  const M_ARCSEC_PER_YEAR = 46.124362;
  const N_ARCSEC_PER_YEAR = 20.043109;
  const JULIAN_YEAR_DAYS = 365.25;
  const DEG_TO_RAD = Math.PI / 180;
  const elapsedYears = (B1875_JD - J2000_JD) / JULIAN_YEAR_DAYS;
  const TOLERANCE_DEG = 1 / 60;

  it.each(CORPUS)('agrees within an arcminute for $name', (star) => {
    const raRad = star.raDeg * DEG_TO_RAD;
    const decRad = star.decDeg * DEG_TO_RAD;
    const expectedRaDeg = star.raDeg
      + ((M_ARCSEC_PER_YEAR + N_ARCSEC_PER_YEAR * Math.sin(raRad) * Math.tan(decRad))
        * elapsedYears) / 3600;
    const expectedDecDeg = star.decDeg
      + (N_ARCSEC_PER_YEAR * Math.cos(raRad) * elapsedYears) / 3600;

    const got = precessRaDec(B1875, star);
    expect(Math.abs(got.raDeg - expectedRaDeg)).toBeLessThan(TOLERANCE_DEG);
    expect(Math.abs(got.decDeg - expectedDecDeg)).toBeLessThan(TOLERANCE_DEG);
  });
});

describe('Vondrák long-term precession', () => {
  const jdOfYear = (y: number) => J2000_JD + (y - 2000) * 365.25;

  /** Angle (deg) between the ecliptic and equator poles = obliquity of date. */
  function obliquityDeg(jd: number): number {
    const e = longTermEclipticPole(jd);
    const q = longTermEquatorPole(jd);
    return (Math.acos(e.x * q.x + e.y * q.y + e.z * q.z) * 180) / Math.PI;
  }

  it('reproduces the J2000 obliquity from the two poles', () => {
    expect(obliquityDeg(J2000_JD)).toBeCloseTo(23.439279, 5);
  });

  it('tracks the obliquity back to 3000 BC', () => {
    // Laskar 1986's 10th-degree expression gives 24.0165° at year −2950;
    // the two models are independent, so agreement to a few arcseconds
    // says the ecliptic and equator series are both being read right.
    expect(obliquityDeg(jdOfYear(-2950))).toBeCloseTo(24.0165, 2);
    expect(obliquityDeg(jdOfYear(2950))).toBeLessThan(23.43);
  });

  it('carries the celestial pole past Thuban in the third millennium BC', () => {
    // α Draconis was the pole star around 2787 BC. Nothing else in the
    // chain reproduces that: the linear IAU row misses it by ~10°.
    const thuban = unitVectorFromRaDec(211.09725, 64.37585);
    let best = Infinity;
    let bestYear = 0;
    for (let y = -3000; y <= -2000; y += 5) {
      const p = longTermEquatorPole(jdOfYear(y));
      const sep = Math.acos(Math.min(1, p.x * thuban.x + p.y * thuban.y + p.z * thuban.z));
      if (sep < best) {
        best = sep;
        bestYear = y;
      }
    }
    expect((best * 180) / Math.PI).toBeLessThan(0.1);
    expect(bestYear).toBeGreaterThan(-2820);
    expect(bestYear).toBeLessThan(-2750);
  });

  it('agrees with the IAU 1976 rotation where that model is valid', () => {
    // The two coexist deliberately: IAU 1976 owns the B1875 constellation
    // boundaries, the long-term model owns the model clock. They must not
    // disagree in the overlap, or the boundaries and the sky drift apart.
    for (const jd of [B1875_JD, jdOfYear(1950), jdOfYear(2050)]) {
      const a = longTermEquatorRotationFromJ2000(jd);
      const b = precessionRotationFromJ2000(jd);
      for (const v of [
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 },
      ]) {
        const p = precessDirection(a, v);
        const q = precessDirection(b, v);
        const sepArcsec = Math.acos(Math.min(1, p.x * q.x + p.y * q.y + p.z * q.z)) / ARCSEC_TO_RAD;
        expect(sepArcsec).toBeLessThan(0.5);
      }
    }
  });

  it('is the identity at J2000 for both frames', () => {
    const equ = longTermEquatorRotationFromJ2000(J2000_JD);
    const ecl = longTermEclipticRotationFromJ2000(J2000_JD);
    // The equator frame is the ICRS frame at J2000 to within the model's
    // own sub-arcsecond offset; the ecliptic frame is that tilted by ε.
    expect(equ[8]).toBeGreaterThan(1 - 1e-12);
    expect(ecl[0]).toBeGreaterThan(1 - 1e-12);
    expect(ecl[8]).toBeCloseTo(Math.cos((23.439279 * Math.PI) / 180), 6);
  });
});
