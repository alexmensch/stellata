import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { coverageRadiusPc, makeDustField, type DustParams } from './dust-grid';
import {
  coverageSpan,
  LocalFroxel,
  measuredColumn,
  referenceStepPc,
  tangentBasis,
  type FroxelConfig,
  type Ray,
} from './froxel';
import {
  PINNED_CELL_RAD,
  PINNED_FILL_STEPS_PER_VOXEL,
  PINNED_SLICES,
} from '../../../src/client/dust/froxel/froxel-pins';
import {
  S_MIN_PC,
  SOL_GALACTOCENTRIC_PC,
  galacticDirection,
} from '../../../src/client/milkyway/milkyway-column-pure';

const GRID = 32;
const PARAMS: DustParams = {
  gridSize: GRID,
  chunkSize: GRID / 4,
  chunksPerAxis: 4,
  boundsHalfPc: 1250,
  voxelPc: (2 * 1250) / GRID,
  densityMin: 1e-7,
  densityMax: 0.2,
  avPerDensityPerPc: 2.742,
};
const UNIFORM_CODE = 200;

/** A field of one density everywhere inside the cube, so every column has a
 *  closed form and the read's own error is the only thing left. */
const uniform = makeDustField(PARAMS, new Uint8Array(GRID ** 3).fill(UNIFORM_CODE));
const RHO = uniform.decode[UNIFORM_CODE];
const AV_PER_PC = RHO * PARAMS.avPerDensityPerPc;
const RADIUS = coverageRadiusPc(PARAMS);

function solRay(lDeg: number, bDeg: number): Ray {
  const d = galacticDirection(lDeg, bDeg);
  return {
    o: new THREE.Vector3(...SOL_GALACTOCENTRIC_PC),
    u: new THREE.Vector3(d[0], d[1], d[2]),
  };
}

const CFG: FroxelConfig = {
  cellRad: PINNED_CELL_RAD,
  slices: PINNED_SLICES,
  phase: [0, 0],
  rollRad: 0,
  supersample: 1,
  fillStepsPerVoxel: PINNED_FILL_STEPS_PER_VOXEL,
};

describe('coverage span', () => {
  it('spans camera to the sphere for a camera at its centre', () => {
    for (const [l, b] of [[0, 0], [90, 0], [180, 45], [0, -90]]) {
      const cov = coverageSpan(solRay(l, b), RADIUS);
      expect(cov.hit).toBe(true);
      expect(cov.sIn).toBe(0);
      expect(cov.sOut).toBeCloseTo(RADIUS, 6);
    }
  });

  it('reports entry and exit for a camera outside, and a miss past the limb', () => {
    const offset = 3000;
    const origin = new THREE.Vector3(SOL_GALACTOCENTRIC_PC[0] + offset, 0, 0);
    const towardSol = galacticDirection(180, 0);
    const hit = coverageSpan(
      { o: origin, u: new THREE.Vector3(towardSol[0], towardSol[1], towardSol[2]) },
      RADIUS,
    );
    expect(hit.hit).toBe(true);
    expect(hit.sIn).toBeCloseTo(offset - RADIUS, 6);
    expect(hit.sOut).toBeCloseTo(offset + RADIUS, 6);

    // The sphere subtends asin(1250/3000) = 24.6 deg from there.
    const past = galacticDirection(180, 30);
    expect(
      coverageSpan(
        { o: origin, u: new THREE.Vector3(past[0], past[1], past[2]) },
        RADIUS,
      ).hit,
    ).toBe(false);
  });

  it('misses when the sphere is behind the camera', () => {
    const origin = new THREE.Vector3(SOL_GALACTOCENTRIC_PC[0] + 3000, 0, 0);
    const away = galacticDirection(0, 0);
    expect(
      coverageSpan({ o: origin, u: new THREE.Vector3(away[0], away[1], away[2]) }, RADIUS).hit,
    ).toBe(false);
  });
});

describe('reference march', () => {
  it('integrates a uniform field to rho x path length', () => {
    const ray = solRay(37, 12);
    const step = referenceStepPc(uniform);
    expect(measuredColumn(uniform, ray, 100, 500, step)).toBeCloseTo(AV_PER_PC * 400, 10);
  });

  it('is step-rate independent on a uniform field', () => {
    const ray = solRay(37, 12);
    const coarse = measuredColumn(uniform, ray, 100, 500, PARAMS.voxelPc);
    const fine = measuredColumn(uniform, ray, 100, 500, PARAMS.voxelPc / 8);
    expect(coarse).toBeCloseTo(fine, 10);
  });
});

describe('froxel read', () => {
  const dir = new THREE.Vector3(...galacticDirection(20, 8)).normalize();
  const origin = new THREE.Vector3(...SOL_GALACTOCENTRIC_PC);

  it('telescopes: the whole span reads the whole column whatever the slice count', () => {
    // From S_MIN_PC, not from the camera — the first parsec is below the log
    // axis's floor and no slice covers it.
    for (const slices of [8, 24, 32, 64]) {
      const froxel = new LocalFroxel(uniform, origin, dir, { ...CFG, slices });
      expect(froxel.cumulative(dir, RADIUS)).toBeCloseTo(AV_PER_PC * (RADIUS - S_MIN_PC), 6);
    }
  });

  it('is exact at a slice boundary and within 1% between two', () => {
    const froxel = new LocalFroxel(uniform, origin, dir, CFG);
    const logStep = Math.log(RADIUS / S_MIN_PC) / PINNED_SLICES;
    const boundary = Math.exp(16 * logStep);
    expect(froxel.cumulative(dir, boundary)).toBeCloseTo(AV_PER_PC * (boundary - S_MIN_PC), 6);

    const mid = Math.exp(16.5 * logStep);
    const err = Math.abs(froxel.cumulative(dir, mid) - AV_PER_PC * (mid - S_MIN_PC));
    expect(err / (AV_PER_PC * mid)).toBeLessThan(0.01);
  });

  it('reads zero before the entry distance', () => {
    const froxel = new LocalFroxel(uniform, origin, dir, CFG);
    expect(froxel.cumulative(dir, 0)).toBe(0);
  });

  it('is invariant to pose and supersampling on a uniform field', () => {
    const base = new LocalFroxel(uniform, origin, dir, CFG).measuredAv(dir, 10, 900);
    const posed = new LocalFroxel(uniform, origin, dir, {
      ...CFG,
      phase: [0.37, 0.62],
      rollRad: 0.7,
    }).measuredAv(dir, 10, 900);
    const supersampled = new LocalFroxel(uniform, origin, dir, {
      ...CFG,
      supersample: 2,
    }).measuredAv(dir, 10, 900);
    expect(posed).toBeCloseTo(base, 6);
    expect(supersampled).toBeCloseTo(base, 6);
  });

  it('builds one ray per cell, or the square of the supersample factor', () => {
    const one = new LocalFroxel(uniform, origin, dir, CFG);
    one.cumulative(dir, 500);
    expect(one.cellsBuilt).toBe(4);
    const four = new LocalFroxel(uniform, origin, dir, { ...CFG, supersample: 2 });
    four.cumulative(dir, 500);
    expect(four.cellsBuilt).toBe(16);
  });

  it('costs the fill in proportion to the rate, and reads the same column', () => {
    const half = new LocalFroxel(uniform, origin, dir, { ...CFG, fillStepsPerVoxel: 1 });
    const quarter = new LocalFroxel(uniform, origin, dir, { ...CFG, fillStepsPerVoxel: 4 });
    expect(half.measuredAv(dir, 10, 900)).toBeCloseTo(quarter.measuredAv(dir, 10, 900), 6);
  });

  it('keys every cell distinctly, out to the widest angle a direction can reach', () => {
    const froxel = new LocalFroxel(uniform, origin, dir, CFG);
    const [e1, e2] = tangentBasis(dir);
    const seen = new Set<number>();
    for (const t of [-1, -0.5, 0, 0.5, 1]) {
      for (const u of [-1, -0.5, 0, 0.5, 1]) {
        const probe = new THREE.Vector3()
          .copy(dir)
          .addScaledVector(e1, t)
          .addScaledVector(e2, u)
          .normalize();
        froxel.cumulative(probe, 500);
        seen.add(Math.round(probe.dot(e1) / CFG.cellRad) * 1e6 + Math.round(probe.dot(e2) / CFG.cellRad));
      }
    }
    // 25 distinct cell coordinates → 25 × 4 bilinear taps, all cached
    // separately, so a collision would show up as fewer rays built.
    expect(seen.size).toBe(25);
    expect(froxel.cellsBuilt).toBeGreaterThanOrEqual(seen.size);
  });
});

describe('tangent basis', () => {
  it('returns an orthonormal pair perpendicular to the sightline', () => {
    for (const [l, b] of [[0, 0], [123, 60], [45, -89]]) {
      const u = new THREE.Vector3(...galacticDirection(l, b)).normalize();
      const [e1, e2] = tangentBasis(u, 0.4);
      expect(e1.length()).toBeCloseTo(1, 12);
      expect(e2.length()).toBeCloseTo(1, 12);
      expect(e1.dot(e2)).toBeCloseTo(0, 12);
      expect(e1.dot(u)).toBeCloseTo(0, 12);
      expect(e2.dot(u)).toBeCloseTo(0, 12);
    }
  });

  it('rolls the pair about the sightline by the given angle', () => {
    const u = new THREE.Vector3(...galacticDirection(30, 15)).normalize();
    const [a1] = tangentBasis(u, 0);
    const [b1] = tangentBasis(u, Math.PI / 3);
    expect(a1.dot(b1)).toBeCloseTo(Math.cos(Math.PI / 3), 12);
  });
});
