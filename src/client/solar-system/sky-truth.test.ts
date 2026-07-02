// Sky-truth regression corpus, solar-system half: the production
// ephemeris → ecliptic→ICRS chain vs JPL Horizons geocentric RA/Dec
// frozen in data/horizons/. See data/horizons/README.md for provenance.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  getPlanetPositions,
  _resetCacheForTests,
  type PlanetName,
  type Vec3,
} from './ephemeris';
import { ECLIPTIC_NORTH_POLE_ICRS } from './orbit-rings-layer';
import { jdeToT } from './time';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRUTH_TSV = resolve(__dirname, '../../../data/horizons/planet-radec-truth.tsv');

interface TruthRow {
  body: PlanetName | 'sun';
  jdUt: number;
  raDeg: number;
  decDeg: number;
}

function loadTruth(): TruthRow[] {
  const lines = readFileSync(TRUTH_TSV, 'utf-8').trim().split('\n');
  return lines.slice(1).map((line) => {
    const [body, jd, ra, dec] = line.split('\t');
    return {
      body: body as TruthRow['body'],
      jdUt: Number(jd),
      raDeg: Number(ra),
      decDeg: Number(dec),
    };
  });
}

// The same quaternion construction planet-body-field.attachHost and
// OrbitRingsLayer.setPlanetSystem use for Sol — this is the chain under
// test, so it must NOT be replaced with an analytically-built rotation.
const ECL_TO_ICRS = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 0, 1),
  ECLIPTIC_NORTH_POLE_ICRS.clone(),
);

/** Geocentric ICRS direction of `body` at Julian Date `jdUt` through the
 *  production chain: Standish ephemeris → heliocentric ecliptic →
 *  subtract Earth → ecliptic→ICRS quaternion. */
function geocentricIcrsDir(body: TruthRow['body'], jdUt: number): THREE.Vector3 {
  _resetCacheForTests();
  const pos = getPlanetPositions(jdeToT(jdUt));
  const earth = pos.earth;
  const target: Vec3 = body === 'sun' ? { x: 0, y: 0, z: 0 } : pos[body];
  return new THREE.Vector3(
    target.x - earth.x,
    target.y - earth.y,
    target.z - earth.z,
  ).normalize().applyQuaternion(ECL_TO_ICRS);
}

function raDecToDir(raDeg: number, decDeg: number): THREE.Vector3 {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(dec) * Math.cos(ra),
    Math.cos(dec) * Math.sin(ra),
    Math.sin(dec),
  );
}

function separationDeg(a: THREE.Vector3, b: THREE.Vector3): number {
  return (a.angleTo(b) * 180) / Math.PI;
}

// Empirical worst case across the corpus is Saturn at 0.35° (Standish
// linear-elements residual near the Jupiter–Saturn great inequality);
// everything else sits under 0.15°, the Sun under 0.005°. Our chain's
// own approximations (EM-Bary for Earth, no light-time, UT-as-TDB) are
// all well under 0.05°. Any pole mirror, quaternion-order, or deg/rad
// regression produces tens of degrees — far past either bound.
const TOL_DEG = 0.5;
const TOL_SUN_DEG = 0.1;

describe('sky-truth: planets vs JPL Horizons (DE441)', () => {
  const rows = loadTruth();

  it('fixture covers 9 bodies × 3 epochs', () => {
    expect(rows.length).toBe(27);
    expect(new Set(rows.map((r) => r.body)).size).toBe(9);
    expect(new Set(rows.map((r) => r.jdUt)).size).toBe(3);
  });

  for (const row of rows) {
    const tol = row.body === 'sun' ? TOL_SUN_DEG : TOL_DEG;
    it(`${row.body} @ JD ${row.jdUt} within ${tol}° of Horizons`, () => {
      const ours = geocentricIcrsDir(row.body, row.jdUt);
      const truth = raDecToDir(row.raDeg, row.decDeg);
      expect(separationDeg(ours, truth)).toBeLessThan(tol);
    });
  }
});

describe('sky-truth: Sun declination at solstices and equinoxes', () => {
  // Self-anchored mirror detectors — no external fixture needed. The
  // Sun's declination extremes are ±obliquity (~23.44°); a mirrored
  // ecliptic pole negates them, so these fail by ~47° on a sign flip.
  const J2000_JD = 2451545.0;

  function sunDecDeg(jdUt: number): number {
    return (Math.asin(geocentricIcrsDir('sun', jdUt).z) * 180) / Math.PI;
  }

  /** Extreme Sun Dec over a ±2-day window sampled hourly. */
  function extremeDec(jdCentre: number, kind: 'max' | 'min'): number {
    let best = kind === 'max' ? -Infinity : Infinity;
    for (let h = -48; h <= 48; h++) {
      const dec = sunDecDeg(jdCentre + h / 24);
      best = kind === 'max' ? Math.max(best, dec) : Math.min(best, dec);
    }
    return best;
  }

  it('June 2026 solstice: Sun peaks near Dec +23.44° (northern summer)', () => {
    // 2026-06-21 ≈ J2000 + 9668 d.
    expect(extremeDec(J2000_JD + 9668, 'max')).toBeCloseTo(23.44, 1);
  });

  it('December 2026 solstice: Sun bottoms near Dec −23.44°', () => {
    // 2026-12-21 ≈ J2000 + 9851 d.
    expect(extremeDec(J2000_JD + 9851, 'min')).toBeCloseTo(-23.44, 1);
  });

  it('March 2026 equinox: Sun Dec crosses zero heading north', () => {
    // 2026-03-20 ≈ J2000 + 9575 d.
    const before = sunDecDeg(J2000_JD + 9574);
    const after = sunDecDeg(J2000_JD + 9576);
    expect(before).toBeLessThan(0);
    expect(after).toBeGreaterThan(0);
  });
});
