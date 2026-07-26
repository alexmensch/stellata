// Sky-truth regression corpus, solar-system half: the production
// ephemeris → ecliptic→ICRS chain vs JPL Horizons geocentric RA/Dec
// frozen in data/horizons/. See data/horizons/README.md for provenance.

import { beforeAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { ELEMENT_TARGETS } from '../../../../scripts/ephemerides/planet-element-roster';
import type { PlanetElementTableFile } from '../../../../scripts/ephemerides/planet-element-schema';
import { AU_PER_PC, LIGHT_TIME_PER_AU_S } from '../../util/astronomy-constants';
import { buildElementTable, type PlanetElementTable } from './element-table';
import {
  getPlanetPositions,
  installPlanetElementTables,
  resetPositionCache,
  type PlanetName,
  type Vec3,
} from './ephemeris';
import { MOON_ELEMENTS, earthMoonSplit, moonOffsetEcliptic } from './moon-ephemeris';
import { ECLIPTIC_NORTH_POLE_ICRS } from './orbit-rings-layer';
import { HELIOPAUSE_APEX_SOL_PC } from '../heliopause/heliopause';
import { jdeToT } from '../time/time';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRUTH_TSV = resolve(__dirname, '../../../../data/horizons/planet-radec-truth.tsv');
const TABLE_DIR = resolve(__dirname, '../../../../data/ephemerides');

// All three corpus epochs sit inside the element tables' window, so this is
// the production configuration.
beforeAll(() => {
  const tables = new Map<PlanetName, PlanetElementTable>();
  for (const target of ELEMENT_TARGETS) {
    tables.set(target.id, buildElementTable(
      JSON.parse(readFileSync(resolve(TABLE_DIR, `${target.id}.json`), 'utf-8')) as PlanetElementTableFile,
    ));
  }
  installPlanetElementTables(tables);
});

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

const MOON = MOON_ELEMENTS.find((m) => m.name === 'Moon')!;
const moonOffset: Vec3 = { x: 0, y: 0, z: 0 };
const earthCentre: Vec3 = { x: 0, y: 0, z: 0 };
const moonCentre: Vec3 = { x: 0, y: 0, z: 0 };

/** Earth's **centre**, heliocentric ecliptic parsecs, at model time `t`. The
 *  ephemeris resolves the Earth/Moon barycentre, and Earth sits ~4,700 km off
 *  it — 11″ of Mercury's geocentric direction. */
function earthCentreAt(t: number): Vec3 {
  resetPositionCache();
  const bary = getPlanetPositions(t).earth;
  moonOffsetEcliptic(MOON, t, moonOffset);
  earthMoonSplit(bary, moonOffset, earthCentre, moonCentre);
  return { ...earthCentre };
}

function heliocentricAt(body: TruthRow['body'], t: number): Vec3 {
  if (body === 'sun') return { x: 0, y: 0, z: 0 };
  if (body === 'earth') return earthCentreAt(t);
  resetPositionCache();
  return getPlanetPositions(t)[body];
}

/**
 * Geocentric ICRS direction of `body` at Julian Date `jdUt` through the
 * production chain: ephemeris → heliocentric ecliptic → subtract Earth's
 * centre → ecliptic→ICRS quaternion.
 *
 * The truth rows are **astrometric**, so the target is evaluated one light
 * time before the observer. One iteration suffices — the range moves by under
 * 1e-4 AU over a light time, three orders below what the tolerance resolves.
 */
function geocentricIcrsDir(body: TruthRow['body'], jdUt: number): THREE.Vector3 {
  const t = jdeToT(jdUt);
  const observer = earthCentreAt(t);
  const geometric = heliocentricAt(body, t);
  const rangeAu = Math.hypot(
    geometric.x - observer.x,
    geometric.y - observer.y,
    geometric.z - observer.z,
  ) * AU_PER_PC;
  const retarded = heliocentricAt(body, t - rangeAu * LIGHT_TIME_PER_AU_S);
  return new THREE.Vector3(
    retarded.x - observer.x,
    retarded.y - observer.y,
    retarded.z - observer.z,
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

// Empirical worst case across the corpus is 1.17″ (Pluto); the median is
// ~0.05″ and the Sun sits under 0.72″. What remains at that scale is the
// element tables' own few-1e-6 AU residual plus the second light-time
// iteration this chain does not do — everything coarser has been removed:
// the epochs go in as TDB, Earth is its own centre rather than the
// Earth/Moon barycentre, and the target is retarded by one light time.
// Any pole mirror, quaternion-order, or deg/rad regression still produces
// tens of degrees — five orders past either bound.
const TOL_DEG = 4e-4;
const TOL_SUN_DEG = 2.5e-4;

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

describe('sky-truth: heliopause nose vs the IBEX ISM inflow', () => {
  // McComas et al. 2015 (ApJS 220, 22): interstellar He inflow from
  // J2000 ecliptic (λ, β) = (255.7°, 5.1°) — the upwind/nose direction.
  // The solar apex of motion vs nearby stars (RA 17h53m, Dec +27.4°)
  // sits ~47° away and once shipped as the nose anchor.
  const noseLon = 255.7 * Math.PI / 180;
  const noseLat = 5.1 * Math.PI / 180;
  const noseIcrs = new THREE.Vector3(
    Math.cos(noseLat) * Math.cos(noseLon),
    Math.cos(noseLat) * Math.sin(noseLon),
    Math.sin(noseLat),
  ).applyQuaternion(ECL_TO_ICRS);

  it('production upwind apex matches the published inflow within 0.01°', () => {
    const apex = new THREE.Vector3()
      .copy(HELIOPAUSE_APEX_SOL_PC)
      .normalize();
    expect(separationDeg(apex, noseIcrs)).toBeLessThan(0.01);
  });

  it('solar apex of motion is NOT the nose — ~47° away', () => {
    const solarApex = raDecToDir(268.25, 27.4);
    expect(separationDeg(noseIcrs, solarApex)).toBeGreaterThan(45);
  });

  it('Voyager 1 heliopause-crossing direction sits ~30° off-nose', () => {
    // V1 outbound at roughly RA 258°, Dec +12° — crossed the heliopause
    // at 122 AU, consistent with a flank ~30° from a Dec −17.6° nose
    // and impossible for a Dec +27.4° nose (V1 would be near-nose yet
    // crossed at the nose distance).
    const apex = new THREE.Vector3()
      .copy(HELIOPAUSE_APEX_SOL_PC)
      .normalize();
    const v1 = raDecToDir(258, 12);
    const sep = separationDeg(apex, v1);
    expect(sep).toBeGreaterThan(25);
    expect(sep).toBeLessThan(35);
  });
});
