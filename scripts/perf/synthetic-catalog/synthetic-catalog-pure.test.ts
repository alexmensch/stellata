import { describe, expect, it } from 'vitest';
import {
  DISC_SCALE_HEIGHT_PC,
  SOL_GALACTOCENTRIC_PC,
} from '../../../src/client/milkyway/milkyway-column-pure';
import {
  GAIA_CENSUS_BY_G,
  buildIntrinsicPool,
  distanceModulus,
  drawTupleBrighterThan,
  equalAreaSkyGrid,
  galacticUnitVector,
  galactocentricRz,
  marchSightline,
  marchStepPc,
  mulberry32,
  numberDensityAt,
  poolCountBrighterThan,
  sampleCdf,
  sightlineWeights,
  skyCellSolidAngle,
  toCdf,
  type IntrinsicTuple,
} from './synthetic-catalog-pure';

const tuple = (absMag: number): IntrinsicTuple => ({
  absMag,
  ci: 0.65,
  physRadius: 1,
  spectClass: 4,
  lumClass: 2,
});

describe('census targets', () => {
  it('carries the ESA TAP counts the epic pins', () => {
    expect(GAIA_CENSUS_BY_G.get(11)).toBe(1_247_240);
    expect(GAIA_CENSUS_BY_G.get(12)).toBe(3_087_828);
    expect(GAIA_CENSUS_BY_G.get(13)).toBe(7_369_632);
  });
});

describe('photometry', () => {
  it('vanishes at 10 pc, where apparent and absolute magnitude agree', () => {
    expect(distanceModulus(10)).toBe(0);
  });

  it('adds five magnitudes per factor of ten in distance', () => {
    expect(distanceModulus(100)).toBeCloseTo(5, 10);
    expect(distanceModulus(1000)).toBeCloseTo(10, 10);
  });
});

describe('intrinsic pool', () => {
  const pool = buildIntrinsicPool([tuple(5), tuple(-1), tuple(12), tuple(3)]);

  it('sorts brightest-first so a truncated draw is a prefix', () => {
    expect(pool.tuples.map((t) => t.absMag)).toEqual([-1, 3, 5, 12]);
  });

  it('counts exactly the tuples at or brighter than the cut', () => {
    expect(poolCountBrighterThan(pool, -2)).toBe(0);
    expect(poolCountBrighterThan(pool, -1)).toBe(1);
    expect(poolCountBrighterThan(pool, 5)).toBe(3);
    expect(poolCountBrighterThan(pool, 99)).toBe(4);
  });

  it('never draws a tuple fainter than the cut', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const t = drawTupleBrighterThan(pool, 5, rng);
      expect(t).not.toBeNull();
      expect(t!.absMag).toBeLessThanOrEqual(5);
    }
  });

  it('returns null when nothing is bright enough', () => {
    expect(drawTupleBrighterThan(pool, -10, mulberry32(1))).toBeNull();
  });
});

describe('galactic geometry', () => {
  it('puts Sol at R0 from the centre with zero height', () => {
    const { rPc, zPc } = galactocentricRz(galacticUnitVector(0, 0), 0);
    expect(rPc).toBeCloseTo(Math.abs(SOL_GALACTOCENTRIC_PC[0]), 6);
    expect(zPc).toBeCloseTo(0, 10);
  });

  it('walks toward the centre along l=0, b=0', () => {
    const dir = galacticUnitVector(0, 0);
    const near = galactocentricRz(dir, 1000);
    const far = galactocentricRz(dir, 4000);
    expect(far.rPc).toBeLessThan(near.rPc);
  });

  it('climbs out of the plane toward the pole', () => {
    const { zPc } = galactocentricRz(galacticUnitVector(0, Math.PI / 2), 500);
    expect(zPc).toBeCloseTo(500, 6);
  });
});

const R0_PC = Math.abs(SOL_GALACTOCENTRIC_PC[0]);

describe('number density', () => {
  it('falls off with height above the plane', () => {
    const mid = numberDensityAt(R0_PC, 0);
    const up = numberDensityAt(R0_PC, DISC_SCALE_HEIGHT_PC);
    expect(up).toBeGreaterThan(0);
    expect(up).toBeLessThan(mid);
  });

  it('is zero outside both proxy envelopes', () => {
    expect(numberDensityAt(30_000, 0)).toBe(0);
    expect(numberDensityAt(R0_PC, 5000)).toBe(0);
  });

  it('is brightest toward the centre', () => {
    expect(numberDensityAt(500, 0)).toBeGreaterThan(numberDensityAt(12_000, 0));
  });
});

describe('sightline march', () => {
  it('accumulates extinction monotonically outward', () => {
    const march = marchSightline(galacticUnitVector(0, 0), 5000, 64);
    for (let i = 1; i < march.length; i++) {
      expect(march[i].extinctionMag).toBeGreaterThanOrEqual(march[i - 1].extinctionMag);
    }
  });

  it('extincts the plane far harder than the pole', () => {
    const plane = marchSightline(galacticUnitVector(0, 0), 3000, 96);
    const pole = marchSightline(galacticUnitVector(0, Math.PI / 2), 3000, 96);
    const last = (m: ReturnType<typeof marchSightline>) => m[m.length - 1].extinctionMag;
    expect(last(plane)).toBeGreaterThan(last(pole) * 5);
  });

  it('reports the step the sampler jitters a drawn distance across', () => {
    expect(marchStepPc(marchSightline(galacticUnitVector(0, 0), 4800, 64))).toBeCloseTo(75, 10);
  });

  it('reports a zero step for a march too short to have one', () => {
    expect(marchStepPc([])).toBe(0);
    expect(marchStepPc(marchSightline(galacticUnitVector(0, 0), 100, 1))).toBe(0);
  });
});

describe('sightline weights', () => {
  const pool = buildIntrinsicPool(
    Array.from({ length: 100 }, (_, i) => tuple(-2 + i * 0.15)),
  );

  it('zeroes everything closer than the floor', () => {
    const march = marchSightline(galacticUnitVector(0, 0), 5000, 64);
    const w = sightlineWeights(march, pool, 11, 1, 2000);
    march.forEach((s, i) => {
      if (s.distPc < 2000) expect(w[i]).toBe(0);
    });
  });

  it('puts more weight toward the plane than the pole', () => {
    const sum = (bRad: number) => {
      const march = marchSightline(galacticUnitVector(0, bRad), 15_000, 128);
      return sightlineWeights(march, pool, 11, 1, 50).reduce((a, b) => a + b, 0);
    };
    expect(sum(0)).toBeGreaterThan(sum(Math.PI / 2));
  });
});

describe('cdf sampling', () => {
  it('accumulates to the total', () => {
    expect(toCdf([1, 2, 3])).toEqual([1, 3, 6]);
  });

  it('refuses an all-zero distribution', () => {
    expect(sampleCdf(toCdf([0, 0, 0]), 0.5)).toBe(-1);
  });

  it('never picks a zero-weight bin', () => {
    const cdf = toCdf([0, 5, 0, 5, 0]);
    const rng = mulberry32(3);
    for (let i = 0; i < 500; i++) {
      expect([1, 3]).toContain(sampleCdf(cdf, rng()));
    }
  });

  it('lands in proportion to the weights', () => {
    const cdf = toCdf([1, 3]);
    const rng = mulberry32(11);
    let ones = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) if (sampleCdf(cdf, rng()) === 1) ones++;
    expect(ones / n).toBeCloseTo(0.75, 1);
  });
});

describe('equal-area sky grid', () => {
  it('gives every cell the same solid angle, summing to the sphere', () => {
    const cells = equalAreaSkyGrid(8, 4);
    expect(cells).toHaveLength(32);
    expect(skyCellSolidAngle(8, 4) * cells.length).toBeCloseTo(4 * Math.PI, 10);
  });

  it('spreads latitudes symmetrically about the plane', () => {
    const bs = equalAreaSkyGrid(1, 6).map((c) => c.bRad);
    expect(bs.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 10);
  });
});

describe('prng', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('stays in the unit interval', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
