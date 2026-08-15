// Earth's full orientation chain vs frozen Horizons sub-solar lon/lat
// across the whole model clock. See README.md § Earth is not a linear row.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EARTH_ROTATION,
  poleRaDecDegAt,
  spinDegAt,
  subObserverLongitudeEastDeg,
} from './rotation-elements-pure';
import { earthSpinDeg, greenwichSiderealDeg } from './earth-orientation-pure';
import {
  getPlanetPositions,
  resetPositionCache,
} from '../../ephemerides/ephemeris';
import {
  earthMoonSplit,
  MOON_ELEMENTS,
  moonOffsetEcliptic,
} from '../../ephemerides/moon-ephemeris';
import { jdeToT, julianEpochYearToT } from '../../time/time';
import {
  AU_PER_PC,
  J2000_OBLIQUITY_RAD,
  LIGHT_TIME_PER_AU_S,
} from '../../../util/astronomy-constants';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRUTH_TSV = resolve(__dirname, '../../../../../data/horizons/earth-orientation-truth.tsv');

const COS_OBLIQUITY = Math.cos(J2000_OBLIQUITY_RAD);
const SIN_OBLIQUITY = Math.sin(J2000_OBLIQUITY_RAD);
const MOON = MOON_ELEMENTS.find((m) => m.name === 'Moon')!;

interface TruthRow {
  jdUt: number;
  lonEastDeg: number;
  latDeg: number;
}

const TRUTH: TruthRow[] = readFileSync(TRUTH_TSV, 'utf-8')
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => {
    const [jd, lon, lat] = line.split('\t');
    return { jdUt: Number(jd), lonEastDeg: Number(lon), latDeg: Number(lat) };
  });

/** Model sub-solar east longitude at a Horizons UT epoch. Horizons
 *  reports the *apparent* sub-solar point, so the spin is retarded by
 *  one light time — the same convention texture-orientation.test.ts
 *  applies to Mars, Ganymede and Io. */
function modelSubSolarLonDeg(jdUt: number): number {
  const t = jdeToT(jdUt);
  resetPositionCache();
  const bary = getPlanetPositions(t).earth;
  const geo = { x: 0, y: 0, z: 0 };
  const earth = { x: 0, y: 0, z: 0 };
  const moon = { x: 0, y: 0, z: 0 };
  moonOffsetEcliptic(MOON, t, geo);
  earthMoonSplit(bary, geo, earth, moon);

  const lightTimeS = Math.hypot(earth.x, earth.y, earth.z) * AU_PER_PC * LIGHT_TIME_PER_AU_S;
  const ey = -earth.y;
  const ez = -earth.z;
  const dir = {
    x: -earth.x,
    y: COS_OBLIQUITY * ey - SIN_OBLIQUITY * ez,
    z: SIN_OBLIQUITY * ey + COS_OBLIQUITY * ez,
  };
  const n = Math.hypot(dir.x, dir.y, dir.z);
  dir.x /= n;
  dir.y /= n;
  dir.z /= n;
  return subObserverLongitudeEastDeg(EARTH_ROTATION, t - lightTimeS, dir);
}

function wrapDeg(d: number): number {
  let w = d;
  while (w > 180) w -= 360;
  while (w < -180) w += 360;
  return w;
}

beforeEach(() => {
  resetPositionCache();
});

describe('Earth sub-solar longitude vs JPL Horizons', () => {
  it('holds 0.1° across the whole 3000 BC – 3000 AD clamp', () => {
    // 0.1° is 11 km at the equator. The linear IAU row this replaced sat
    // most of a hemisphere out at the lower bound, because it spins on
    // uniform time and Earth does not.
    let worst = 0;
    for (const row of TRUTH) {
      const d = Math.abs(wrapDeg(modelSubSolarLonDeg(row.jdUt) - row.lonEastDeg));
      worst = Math.max(worst, d);
    }
    expect(worst).toBeLessThan(0.1);
  });

  it('holds 0.03° across the epochs a modern eclipse falls in', () => {
    let worst = 0;
    for (const row of TRUTH.filter((r) => Math.abs(r.jdUt - 2451545) < 73050)) {
      const d = Math.abs(wrapDeg(modelSubSolarLonDeg(row.jdUt) - row.lonEastDeg));
      worst = Math.max(worst, d);
    }
    expect(worst).toBeLessThan(0.03);
  });

  it('the corpus reaches both clamp bounds', () => {
    expect(Math.min(...TRUTH.map((r) => r.jdUt))).toBeLessThan(700000);
    expect(Math.max(...TRUTH.map((r) => r.jdUt))).toBeGreaterThan(2780000);
  });
});

describe('Earth orientation model', () => {
  it('supersedes the linear rows through the shared accessors', () => {
    // The row still carries its published pck values; the accessors must
    // read the model instead, or the whole chain silently reverts.
    const t = julianEpochYearToT(-1000);
    const linearW = (EARTH_ROTATION.w0Deg
      + EARTH_ROTATION.wDegPerDay * ((t - julianEpochYearToT(2000)) / 86400)) % 360;
    expect(Math.abs(wrapDeg(spinDegAt(EARTH_ROTATION, t) - linearW))).toBeGreaterThan(1);
    expect(spinDegAt(EARTH_ROTATION, t)).toBeCloseTo(
      ((earthSpinDeg(t) % 360) + 360) % 360, 9,
    );
  });

  it('agrees with the published pck row near J2000, where that row is valid', () => {
    // Compare α0 + W, NOT W. Near J2000 Earth's pole sits on the ICRS
    // pole, so α0 = atan2(y, x) is degenerate — it can come back as any
    // value, and W absorbs exactly the same offset. Only the sum is
    // well-defined, and the composition Rz(90+α0)·Rx(90−δ0)·Rz(W) only
    // ever uses the sum there because Rx(90−δ0) → identity.
    const t = julianEpochYearToT(2000);
    const model = spinDegAt(EARTH_ROTATION, t)
      + poleRaDecDegAt(EARTH_ROTATION, t).raDeg;
    const published = EARTH_ROTATION.w0Deg + EARTH_ROTATION.poleRaDeg;
    // 0.31° apart — the IAU row is an explicitly approximate expression,
    // and the model is built from ERA and the precession frames with
    // nothing fitted to it, so this is mutual confirmation rather than a
    // tolerance either side has to meet.
    expect(Math.abs(wrapDeg(model - published))).toBeLessThan(0.4);
  });

  it('carries the pole to Thuban at the lower clamp bound', () => {
    // ~24° of precession; a model stuck at the J2000 pole would leave
    // every eclipse track at the wrong latitude. α Dra sits at
    // RA 211.1°, Dec +64.4°.
    const early = poleRaDecDegAt(EARTH_ROTATION, julianEpochYearToT(-2900));
    expect(early.decDeg).toBeGreaterThan(63);
    expect(early.decDeg).toBeLessThan(66);
    expect(early.raDeg).toBeGreaterThan(205);
    expect(early.raDeg).toBeLessThan(218);
    expect(poleRaDecDegAt(EARTH_ROTATION, julianEpochYearToT(2900)).decDeg)
      .toBeLessThan(86);
  });

  it('advances sidereal time by a full turn per sidereal day', () => {
    const t0 = julianEpochYearToT(2000);
    const SIDEREAL_DAY_S = 86164.0905;
    const drift = wrapDeg(
      greenwichSiderealDeg(t0 + SIDEREAL_DAY_S) - greenwichSiderealDeg(t0),
    );
    expect(Math.abs(drift)).toBeLessThan(0.001);
  });
});
