import { describe, expect, it } from 'vitest';
import { GALACTIC_NORTH_POLE_ICRS } from '../galactic/galactic-coords';
import { SB_ZERO_POINT } from '../hdr/emission/emission-pure';
import {
  SOL_GALACTOCENTRIC_PC,
  type Vec3,
  galacticDirection,
  sightlineSurfaceBrightness,
} from './milkyway-column-pure';
import {
  BAND_PEAK_DRIFT_MAG_PER_PC,
  BAND_PEAK_FAN_AZIMUTHS,
  BAND_PEAK_FAN_RINGS,
  BAND_PEAK_MARGIN_MAG,
  BAND_PEAK_RECOMPUTE_PC,
  BAND_PEAK_STALENESS_MAG,
  BandPeakCache,
  bandPeakRecomputeRadiusPc,
  MW_PEAK_SB_DUST_FREE,
  bandPeakFan,
  bandPeakSurfaceBrightnessBound,
  galactocentricPc,
} from './band-peak-pure';

const SOL = SOL_GALACTOCENTRIC_PC;

/** The vantage grid the margin is measured over: inside the disc, inside
 *  the bulge, above the plane, and outside the Galaxy out to the camera's
 *  2 Mpc limit. */
const VANTAGES: Record<string, Vec3> = {
  sol: SOL,
  solAbovePlane3kpc: [SOL[0], 0, 3000],
  nearCentreInPlane: [-1000, 0, 0],
  insideBulge: [300, 0, 200],
  aboveCentre20kpc: [0, 0, 20_000],
  out30kpcInPlane: [-30_000, 0, 0],
  out100kpcUp30deg: [-86_600, 0, 50_000],
  out2Mpc: [-2e6, 0, 0],
};

const AXES = [
  [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
] as const;

const DENSE_FACTOR = 8;

function denseSweep(cam: Vec3): number {
  return bandPeakFan(
    cam,
    BAND_PEAK_FAN_RINGS * DENSE_FACTOR,
    BAND_PEAK_FAN_AZIMUTHS * DENSE_FACTOR,
  ).sb;
}

/** Fan minus dense, per vantage: positive means the fan missed something
 *  brighter. Computed once — the dense sweeps are the suite's cost. */
let shortfalls: Record<string, number> | null = null;
function measureShortfalls(): Record<string, number> {
  if (shortfalls) return shortfalls;
  shortfalls = {};
  for (const [name, cam] of Object.entries(VANTAGES)) {
    shortfalls[name] = bandPeakFan(cam).sb - denseSweep(cam);
  }
  return shortfalls;
}

function latitudeDeg(dir: Vec3): number {
  return (Math.asin(dir[2]) * 180) / Math.PI;
}

describe('dust-free ceiling', () => {
  it('is the full central chord, 17.11 mag/arcsec²', () => {
    expect(MW_PEAK_SB_DUST_FREE).toBeCloseTo(17.107, 2);
  });

  it('is brighter than the dusty peak from every vantage on the grid', () => {
    for (const cam of Object.values(VANTAGES)) {
      expect(MW_PEAK_SB_DUST_FREE).toBeLessThan(bandPeakFan(cam).sb);
    }
  });
});

describe('the fan from Sol', () => {
  const peak = bandPeakFan(SOL);

  // The model is symmetric under z → −z, so the two 6.4° sightlines tie.
  it('lands 6.4° off the plane toward the centre at 20.70 mag/arcsec²', () => {
    expect(peak.sb).toBeCloseTo(20.695, 2);
    expect(Math.abs(latitudeDeg(peak.dir))).toBeCloseTo(6.4, 0);
  });

  // Independent of the polar construction: an absolute (l, b) grid.
  it('finds nothing brighter than the bound on a 1°×1° absolute sweep', () => {
    let brightest = Number.POSITIVE_INFINITY;
    for (let l = -180; l < 180; l += 1) {
      for (let b = -90; b <= 90; b += 1) {
        const sb = sightlineSurfaceBrightness(SB_ZERO_POINT, SOL, galacticDirection(l, b));
        if (sb < brightest) brightest = sb;
      }
    }
    expect(brightest).toBeGreaterThanOrEqual(bandPeakSurfaceBrightnessBound(SOL));
  });
});

describe('the margin', () => {
  it.each(Object.keys(VANTAGES))('fan is within the margin of a dense sweep at %s', (name) => {
    expect(measureShortfalls()[name]).toBeLessThanOrEqual(BAND_PEAK_MARGIN_MAG);
  });

  it('pins the worst shortfall over the grid', () => {
    const worstShortfall = Math.max(...Object.values(measureShortfalls()));
    expect(worstShortfall).toBeCloseTo(0.038, 2);
    expect(worstShortfall).toBeLessThanOrEqual(BAND_PEAK_MARGIN_MAG);
  });

  // Vertical travel near the plane is the fastest the peak moves: the
  // brightest sightline skims the 125 pc dust layer.
  it('pins the drift per parsec at Sol, vertical, under the staleness rate', () => {
    const base = bandPeakFan(SOL).sb;
    const step = 10;
    const rate = Math.max(
      ...([[0, 0, 1], [0, 0, -1], [1, 0, 0]] as const).map((axis) => {
        const moved: Vec3 = [SOL[0] + axis[0] * step, SOL[1] + axis[1] * step, SOL[2] + axis[2] * step];
        return Math.abs(bandPeakFan(moved).sb - base) / step;
      }),
    );
    expect(rate).toBeCloseTo(0.006, 3);
    expect(rate).toBeLessThanOrEqual(BAND_PEAK_DRIFT_MAG_PER_PC);
  });

  // The allowance is one constant while the radius is not, so what has to
  // hold is the PRODUCT, at every vantage — and Sol has to stay the vantage
  // that pays the most, or the constant is sized against the wrong one.
  it('the scaled radius buys no more staleness than Sol does', () => {
    const staleness = (cam: Vec3): number => {
      const radius = bandPeakRecomputeRadiusPc(cam);
      const base = bandPeakFan(cam).sb;
      return Math.max(
        ...AXES.map((axis) => {
          const moved: Vec3 = [
            cam[0] + axis[0] * radius, cam[1] + axis[1] * radius, cam[2] + axis[2] * radius,
          ];
          return Math.abs(bandPeakFan(moved).sb - base);
        }),
      );
    };
    const byVantage = Object.fromEntries(
      Object.entries(VANTAGES).map(([name, cam]) => [name, staleness(cam)]),
    );
    for (const [name, mag] of Object.entries(byVantage)) {
      expect(`${name}: ${mag <= BAND_PEAK_STALENESS_MAG}`).toBe(`${name}: true`);
    }
    expect(Math.max(...Object.values(byVantage))).toBeCloseTo(byVantage.sol, 6);
    expect(byVantage.sol).toBeCloseTo(0.060, 3);
  });

  // The whole point of scaling it: at the camera's 2 Mpc limit the bound
  // survives 246× further travel than at Sol, which is also where the camera
  // crosses ground fastest.
  it('widens the radius where distance-invariance makes it free', () => {
    expect(bandPeakRecomputeRadiusPc(SOL)).toBeCloseTo(BAND_PEAK_RECOMPUTE_PC, 6);
    expect(bandPeakRecomputeRadiusPc([300, 0, 200])).toBe(BAND_PEAK_RECOMPUTE_PC);
    expect(bandPeakRecomputeRadiusPc([-2e6, 0, 0])).toBeCloseTo(2462, 0);
  });
});

describe('BandPeakCache', () => {
  const staleBound = (cam: Vec3) => bandPeakSurfaceBrightnessBound(cam) - BAND_PEAK_STALENESS_MAG;

  it('holds its bound inside the recompute radius and refreshes past it', () => {
    const cache = new BandPeakCache();
    const first = cache.boundAt(SOL);
    expect(first).toBe(staleBound(SOL));
    const inside: Vec3 = [SOL[0], SOL[1], SOL[2] + BAND_PEAK_RECOMPUTE_PC * 0.9];
    expect(cache.boundAt(inside)).toBe(first);
    expect(first).toBeLessThan(bandPeakFan(inside).sb);
    const outside: Vec3 = [SOL[0], SOL[1], SOL[2] + BAND_PEAK_RECOMPUTE_PC * 1.1];
    expect(cache.boundAt(outside)).toBe(staleBound(outside));
  });

  it('reset fails the next read back to a recompute', () => {
    const cache = new BandPeakCache();
    cache.boundAt(SOL);
    cache.reset();
    const far: Vec3 = [SOL[0], SOL[1], SOL[2] + 3000];
    expect(cache.boundAt(far)).toBe(staleBound(far));
  });
});

describe('galactocentricPc', () => {
  it('puts Sol at −R₀ along +x', () => {
    const sol = galactocentricPc([0, 0, 0]);
    expect(sol[0]).toBeCloseTo(SOL[0], 6);
    expect(sol[1]).toBeCloseTo(0, 6);
    expect(sol[2]).toBeCloseTo(0, 6);
  });

  it('sends the north galactic pole to +z', () => {
    const n = GALACTIC_NORTH_POLE_ICRS;
    const up = galactocentricPc([n.x * 1000, n.y * 1000, n.z * 1000]);
    expect(up[2] - SOL[2]).toBeCloseTo(1000, 6);
    expect(up[0]).toBeCloseTo(SOL[0], 6);
  });
});
