// Sky-truth regression corpus, moon half: every major moon's
// parent-relative on-sky position vs JPL Horizons geocentric RA/Dec
// frozen in data/horizons/moon-radec-truth.tsv (provenance in its README).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { getPlanetPositions, resetPositionCache, type Vec3 } from './ephemeris';
import { MOON_ELEMENTS, moonOffsetEcliptic } from './moon-ephemeris';
import { ECLIPTIC_NORTH_POLE_ICRS } from './orbit-rings-layer';
import { jdeToT } from '../time/time';
import { KM_PC } from '../../util/astronomy-constants';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRUTH_TSV = resolve(__dirname, '../../../../data/horizons/moon-radec-truth.tsv');
const C_KM_S = 299792.458;
const DEG = Math.PI / 180;

interface TruthRow {
  body: string;
  jdUt: number;
  raDeg: number;
  decDeg: number;
}

function loadTruth(): Map<string, TruthRow[]> {
  const lines = readFileSync(TRUTH_TSV, 'utf-8').trim().split('\n');
  const byBody = new Map<string, TruthRow[]>();
  for (const line of lines.slice(1)) {
    const [body, jd, ra, dec] = line.split('\t');
    const row = { body, jdUt: Number(jd), raDeg: Number(ra), decDeg: Number(dec) };
    const list = byBody.get(body) ?? [];
    list.push(row);
    byBody.set(body, list);
  }
  return byBody;
}

const ECL_TO_ICRS = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 0, 1),
  ECLIPTIC_NORTH_POLE_ICRS.clone(),
);

const PARENT_KEY: Record<string, 'jupiter' | 'saturn' | 'uranus' | 'neptune'> = {
  Jupiter: 'jupiter', Saturn: 'saturn', Uranus: 'uranus', Neptune: 'neptune',
};

/** Tangent-plane (east, north) components of the small angular offset
 *  from sky position A (deg) to B (deg), in degrees. */
function skyOffsetDeg(
  raA: number, decA: number, raB: number, decB: number,
): { east: number; north: number } {
  let dRa = raB - raA;
  if (dRa > 180) dRa -= 360;
  if (dRa < -180) dRa += 360;
  return { east: dRa * Math.cos(decA * DEG), north: decB - decA };
}

function icrsToRaDec(v: THREE.Vector3): { raDeg: number; decDeg: number } {
  const raDeg = (Math.atan2(v.y, v.x) / DEG + 360) % 360;
  return { raDeg, decDeg: Math.asin(v.z / v.length()) / DEG };
}

/** Model geocentric ICRS direction of a Sol body at `t`: heliocentric
 *  ecliptic position (+ moon offset for satellites) minus Earth,
 *  rotated by the same ecliptic→ICRS quaternion the renderer applies. */
function modelGeocentricDir(
  heliopEcl: Readonly<Vec3>,
  earthEcl: Readonly<Vec3>,
): THREE.Vector3 {
  return new THREE.Vector3(
    heliopEcl.x - earthEcl.x,
    heliopEcl.y - earthEcl.y,
    heliopEcl.z - earthEcl.z,
  ).applyQuaternion(ECL_TO_ICRS);
}

function angularDiffDeg(a: number, b: number): number {
  const d = ((a - b) % 360 + 540) % 360 - 180;
  return Math.abs(d);
}

// Per-moon tolerance on the parent-relative position ANGLE — the
// orbital-phase check the corpus exists for (a truncated mean motion
// fails it by tens to hundreds of degrees). The budget is dominated by
// the frozen node/apse of the J2000 mean elements (secular precession
// is not modelled; worst for the eccentric, fast-precessing Moon) plus
// the 0.1°-rounded epoch anomalies. Separation is pinned to ±12% —
// covers a (5–6 digits) + the e-driven radial swing sampled at a
// slightly wrong phase.
const PA_TOL_DEG: Record<string, number> = {
  Moon: 10,
  Io: 6, Europa: 6, Ganymede: 6, Callisto: 6,
  Mimas: 8, Enceladus: 8, Tethys: 8, Dione: 8, Rhea: 8,
  Titan: 6, Iapetus: 8,
  Miranda: 8, Ariel: 8, Umbriel: 8, Titania: 8, Oberon: 8,
  Triton: 6,
};
const SEP_RATIO_TOL = 0.12;

describe('moon sky truth vs Horizons (parent-relative position)', () => {
  const truth = loadTruth();

  it('corpus covers all 18 moons + 4 outer parents at 4 epochs', () => {
    expect(truth.size).toBe(22);
    for (const rows of truth.values()) expect(rows.length).toBe(4);
  });

  for (const elem of MOON_ELEMENTS) {
    const key = elem.name.toLowerCase();
    const rows = truth.get(key)!;

    for (const row of rows ?? []) {
      it(`${elem.name} @ JD ${row.jdUt}: on-sky position angle + separation match`, () => {
        resetPositionCache();
        const t = jdeToT(row.jdUt);
        const pos = getPlanetPositions(t);
        const isEarthMoon = elem.parent === 'Earth';
        const parentEcl = isEarthMoon ? pos.earth : pos[PARENT_KEY[elem.parent]];

        // Horizons quantities are light-time corrected; the moon's
        // orbital anomaly moves fast enough to matter (Io ~6° per
        // Jupiter light-time), so evaluate the offset at emission.
        const distPc = Math.hypot(
          parentEcl.x - pos.earth.x,
          parentEcl.y - pos.earth.y,
          parentEcl.z - pos.earth.z,
        );
        const tEmit = t - distPc / KM_PC / C_KM_S;
        const off = { x: 0, y: 0, z: 0 };
        moonOffsetEcliptic(elem, tEmit, off);
        const moonEcl = isEarthMoon
          ? { x: pos.earth.x + off.x, y: pos.earth.y + off.y, z: pos.earth.z + off.z }
          : { x: parentEcl.x + off.x, y: parentEcl.y + off.y, z: parentEcl.z + off.z };

        // Model offset, projected exactly like the truth offset: both
        // sides go through RA/Dec so the tangent-plane convention is
        // shared, and the parent anchor is each side's own parent
        // (Standish parent error is covered by sky-truth.test.ts).
        const mParent = icrsToRaDec(modelGeocentricDir(parentEcl, pos.earth));
        const mMoon = icrsToRaDec(modelGeocentricDir(moonEcl, pos.earth));
        // The Earth-Moon case anchors on the truth row's own geocentric
        // frame: parent == observer, so the "offset" IS the direction.
        const model = isEarthMoon
          ? { east: 0, north: 0 }
          : skyOffsetDeg(mParent.raDeg, mParent.decDeg, mMoon.raDeg, mMoon.decDeg);

        if (isEarthMoon) {
          // Direct geocentric direction comparison for the Moon.
          const sep = angularDiffDeg(mMoon.raDeg, row.raDeg) * Math.cos(row.decDeg * DEG)
            + 0; // components asserted separately below
          expect(
            Math.hypot(
              (((mMoon.raDeg - row.raDeg + 540) % 360) - 180) * Math.cos(row.decDeg * DEG),
              mMoon.decDeg - row.decDeg,
            ),
            `geocentric direction off by deg`,
          ).toBeLessThan(PA_TOL_DEG.Moon);
          void sep;
          return;
        }

        const parentTruth = truth.get(PARENT_KEY[elem.parent])![rows.indexOf(row)];
        const moonTruth = row;
        const target = skyOffsetDeg(
          parentTruth.raDeg, parentTruth.decDeg, moonTruth.raDeg, moonTruth.decDeg,
        );

        const modelPa = Math.atan2(model.east, model.north) / DEG;
        const truthPa = Math.atan2(target.east, target.north) / DEG;
        const modelSep = Math.hypot(model.east, model.north);
        const truthSep = Math.hypot(target.east, target.north);

        expect(
          angularDiffDeg(modelPa, truthPa),
          `PA ${modelPa.toFixed(1)}° vs ${truthPa.toFixed(1)}° (sep ${truthSep.toFixed(4)}°)`,
        ).toBeLessThan(PA_TOL_DEG[elem.name]);
        expect(
          Math.abs(modelSep / truthSep - 1),
          `sep ${modelSep.toFixed(5)}° vs ${truthSep.toFixed(5)}°`,
        ).toBeLessThan(SEP_RATIO_TOL);
      });
    }
  }
});
