// Texture-orientation truth corpus: the rendered IAU orientation →
// SphereGeometry UV chain vs JPL Horizons sub-observer lon/lat frozen
// in data/horizons/sub-observer-truth.tsv (conventions in its README).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { getPlanetPositions, _resetCacheForTests } from './ephemeris';
import { MOON_ELEMENTS, moonOffsetEcliptic } from './moon-ephemeris';
import { ECLIPTIC_NORTH_POLE_ICRS } from './orbit-rings-layer';
import { iauMeshOrientationQuat } from './planet-mesh-layer';
import {
  MARS_ROTATION,
  MOON_ROTATION_BY_NAME,
  subObserverLongitudeEastDeg,
  type RotationElements,
} from './rotation-elements-pure';
import { jdeToT } from './time';
import { KM_PC } from '../util/astronomy-constants';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRUTH_TSV = resolve(__dirname, '../../../data/horizons/sub-observer-truth.tsv');
const C_KM_S = 299792.458;

interface TruthRow {
  body: 'mars' | 'ganymede' | 'io';
  jdUt: number;
  obLonWestDeg: number;
  obLatDeg: number;
}

function loadTruth(): TruthRow[] {
  const lines = readFileSync(TRUTH_TSV, 'utf-8').trim().split('\n');
  return lines.slice(1).map((line) => {
    const [body, jd, obLonW, obLat] = line.split('\t');
    return {
      body: body as TruthRow['body'],
      jdUt: Number(jd),
      obLonWestDeg: Number(obLonW),
      obLatDeg: Number(obLat),
    };
  });
}

const ECL_TO_ICRS = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 0, 1),
  ECLIPTIC_NORTH_POLE_ICRS.clone(),
);

function rotationFor(body: TruthRow['body']): RotationElements {
  if (body === 'mars') return MARS_ROTATION;
  return MOON_ROTATION_BY_NAME.get(body === 'ganymede' ? 'Ganymede' : 'Io')!;
}

/** Body→Earth unit direction (ICRS) and the body's distance (pc)
 *  through the production chain: Standish heliocentric ecliptic
 *  (+ moon offset), subtract Earth, ecliptic→ICRS quaternion. */
function bodyToEarthIcrs(
  body: TruthRow['body'],
  t: number,
): { dir: THREE.Vector3; distPc: number } {
  _resetCacheForTests();
  const pos = getPlanetPositions(t);
  const p = { ...(body === 'mars' ? pos.mars : pos.jupiter) };
  if (body !== 'mars') {
    const elem = MOON_ELEMENTS.find(
      (m) => m.name.toLowerCase() === body,
    )!;
    const off = { x: 0, y: 0, z: 0 };
    moonOffsetEcliptic(elem, t, off);
    p.x += off.x;
    p.y += off.y;
    p.z += off.z;
  }
  const dir = new THREE.Vector3(
    pos.earth.x - p.x,
    pos.earth.y - p.y,
    pos.earth.z - p.z,
  );
  const distPc = dir.length();
  dir.divideScalar(distPc).applyQuaternion(ECL_TO_ICRS);
  return { dir, distPc };
}

/** Map coordinates the mesh shows toward `dirIcrs`: invert the exact
 *  rendered orientation (iauMeshOrientationQuat), then apply the
 *  SphereGeometry UV convention (u = atan2(z, −x)/2π, v = 1 − θ/π)
 *  and the map-centre offset the spin term carries. */
function sampledMapLonLat(
  rot: RotationElements,
  t: number,
  dirIcrs: THREE.Vector3,
): { eastLonDeg: number; latDeg: number } {
  const q = iauMeshOrientationQuat(rot, t, new THREE.Quaternion());
  const d = dirIcrs.clone().applyQuaternion(q.invert());
  let u = Math.atan2(d.z, -d.x) / (2 * Math.PI);
  if (u < 0) u += 1;
  const centre = rot.mapCenterLonDeg ?? 0;
  return {
    eastLonDeg: centre - 180 + 360 * u,
    latDeg: 90 - (Math.acos(THREE.MathUtils.clamp(d.y, -1, 1)) * 180) / Math.PI,
  };
}

function angularDiffDeg(a: number, b: number): number {
  const d = ((a - b) % 360 + 540) % 360 - 180;
  return Math.abs(d);
}

// Error budget per row — tolerances hold the measured residuals with
// margin while staying far below the 180° flip / mirror errors this
// corpus exists to catch. Contributors: UT-vs-TDB is ~0.3° of Mars
// spin, Galilean pole/PM librations are dropped from the linear W
// terms (up to ~1°), and planetographic-vs-centric latitude differs
// ≤ 0.35° (Mars flattening).
const LON_TOL_DEG = { mars: 1.0, ganymede: 2.0, io: 2.0 } as const;
const LAT_TOL_DEG = 1.0;

describe('texture orientation vs Horizons sub-observer truth', () => {
  const rows = loadTruth();

  it('covers Mars and one straight / one flipped-source Galilean at three epochs', () => {
    expect(rows.length).toBe(9);
  });

  for (const row of rows) {
    const truthEastLon = 360 - row.obLonWestDeg;

    it(`${row.body} @ JD ${row.jdUt}: rendered map point under the observer matches Horizons`, () => {
      const rot = rotationFor(row.body);
      const t = jdeToT(row.jdUt);
      const { dir, distPc } = bodyToEarthIcrs(row.body, t);
      // Horizons evaluates the target state at emission; retard the
      // spin by one light time (Io turns ~4°/lt at opposition).
      const tEmit = t - distPc / KM_PC / C_KM_S;

      const { eastLonDeg, latDeg } = sampledMapLonLat(rot, tEmit, dir);
      expect(
        angularDiffDeg(eastLonDeg, truthEastLon),
        `lon ${eastLonDeg.toFixed(2)}°E vs ${truthEastLon.toFixed(2)}°E`,
      ).toBeLessThan(LON_TOL_DEG[row.body]);
      expect(
        Math.abs(latDeg - row.obLatDeg),
        `lat ${latDeg.toFixed(2)}° vs ${row.obLatDeg.toFixed(2)}°`,
      ).toBeLessThan(LAT_TOL_DEG);
    });

    it(`${row.body} @ JD ${row.jdUt}: scalar sub-observer inverse agrees with the quaternion+UV chain`, () => {
      const rot = rotationFor(row.body);
      const t = jdeToT(row.jdUt);
      const { dir } = bodyToEarthIcrs(row.body, t);
      const scalar = subObserverLongitudeEastDeg(rot, t, dir);
      const uv = sampledMapLonLat(rot, t, dir);
      expect(angularDiffDeg(scalar, uv.eastLonDeg)).toBeLessThan(1e-9);
    });
  }
});
