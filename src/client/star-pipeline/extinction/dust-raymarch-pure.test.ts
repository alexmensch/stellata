import { describe, it, expect } from 'vitest';
import {
  DUST_TAPS_MAX,
  DUST_TAPS_MIN,
  DUST_TAP_PC,
  R_V,
  SLAB_PARALLEL_EPS_PC,
  decodeDensity,
  dustMarchTapCount,
  dustRaymarchAv,
  ebvFromAv,
  reddenedBv,
  segmentCubeOverlap,
  type DustDecodeParams,
} from './dust-raymarch-pure';

// Manifest-matching decode window (public/dust/manifest.json): the full
// ±1250 pc cube, the pure-log density window [1e-7, 0.2] E_ZGR/pc, and
// the 2.742 A_V-per-density factor. World coordinate of a volume sample
// is (uvw − 0.5) × 2·boundsPc.
const P: DustDecodeParams = {
  boundsPc: 1250,
  densityMin: 1e-7,
  logRatio: Math.log(0.2 / 1e-7),
  avPerDensityPc: 2.742,
};
const worldFromU = (u: number) => (u - 0.5) * 2 * P.boundsPc;

describe('dust decode', () => {
  it('inverts the u8 log-window encoding at the endpoints', () => {
    expect(decodeDensity(0, P)).toBeCloseTo(1e-7, 12);
    expect(decodeDensity(1, P)).toBeCloseTo(0.2, 9);
  });
});

describe('segmentCubeOverlap', () => {
  const b = 1250;

  it('is the whole segment when both ends are inside', () => {
    expect(segmentCubeOverlap([0, 100, 0], [500, 0, 0], b)).toEqual([0, 1]);
  });

  it('clips a segment that crosses the cube to its two face crossings', () => {
    expect(segmentCubeOverlap([-2000, 0, 0], [4000, 0, 0], b)).toEqual([0.1875, 0.8125]);
  });

  it('clips a segment leaving the cube at its exit', () => {
    expect(segmentCubeOverlap([0, 0, 0], [2500, 0, 0], b)).toEqual([0, 0.5]);
  });

  it('is empty for a segment wholly outside, and for one parallel to a face it never enters', () => {
    const [t0, t1] = segmentCubeOverlap([2000, 2000, 2000], [1000, 1000, 1000], b);
    expect(t1).toBeLessThanOrEqual(t0);
    expect(segmentCubeOverlap([0, 1300, 0], [500, 0, 0], b)).toEqual([1, 0]);
    expect(segmentCubeOverlap([-2000, 1300, 0], [4000, 0, 0], b)).toEqual([1, 0]);
  });

  it('treats a sub-epsilon component as axis-parallel', () => {
    expect(segmentCubeOverlap([0, 0, 0], [100, SLAB_PARALLEL_EPS_PC / 2, 0], b)).toEqual([0, 1]);
  });
});

describe('dustMarchTapCount', () => {
  it('scales with the in-cube length and clamps to the tap window', () => {
    expect(dustMarchTapCount(0)).toBe(DUST_TAPS_MIN);
    expect(dustMarchTapCount(DUST_TAP_PC + 1e-4)).toBe(DUST_TAPS_MIN);
    expect(dustMarchTapCount(100)).toBe(10);
    expect(dustMarchTapCount(200)).toBe(20);
    expect(dustMarchTapCount(DUST_TAP_PC * DUST_TAPS_MAX)).toBe(DUST_TAPS_MAX);
    expect(dustMarchTapCount(1e6)).toBe(DUST_TAPS_MAX);
  });

  it('takes a tap density argument for the sweep', () => {
    expect(dustMarchTapCount(200, 25)).toBe(8);
  });

  it('takes a cap argument, so the sweep need not re-cap a capped count', () => {
    expect(dustMarchTapCount(1e6, DUST_TAP_PC, 48)).toBe(48);
  });
});

describe('dustRaymarchAv — synthetic single-cloud fixtures', () => {
  it('collapses to the closed form for a uniform field', () => {
    // Constant density → exact whatever the tap count.
    const av = dustRaymarchAv([0, 0, 0], [100, 0, 0], () => 0.85, P);
    const closed = decodeDensity(0.85, P) * 100 * P.avPerDensityPc;
    expect(Math.abs(av - closed)).toBeLessThan(1e-9);
    expect(av).toBeCloseTo(6.2221853899897726, 9);
  });

  it('integrates only the in-cube overlap of a segment that crosses the cube', () => {
    // ±2000 pc along x: 2500 pc of the 4000 lie inside, and the taps are
    // spent on that stretch alone, so the uniform closed form holds.
    const av = dustRaymarchAv([-2000, 0, 0], [2000, 0, 0], () => 0.85, P);
    expect(av).toBeCloseTo(decodeDensity(0.85, P) * 2500 * P.avPerDensityPc, 8);
    expect(av).toBeCloseTo(155.5546347497444, 8);
  });

  describe('a Gaussian core through its centre', () => {
    // Peak encoded 0.9, 15 pc Gaussian, marched through the centre along x.
    const core = (u: number, v: number, w: number) => {
      void v;
      void w;
      const x = worldFromU(u);
      return 0.9 * Math.exp(-((x / 15) ** 2));
    };
    const reference = (() => {
      const n = 200_000;
      const step = 200 / n;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const x = -100 + (i + 0.5) * step;
        sum += decodeDensity(core(x / (2 * P.boundsPc) + 0.5, 0.5, 0.5), P);
      }
      return sum * step * P.avPerDensityPc;
    })();

    it('converges toward the reference as the tap density rises', () => {
      const coarse = dustRaymarchAv([-100, 0, 0], [100, 0, 0], core, P, (l) => dustMarchTapCount(l, 15));
      const fine = dustRaymarchAv([-100, 0, 0], [100, 0, 0], core, P);
      expect(coarse).toBeCloseTo(0.2597246789362073, 9);
      expect(fine).toBeCloseTo(0.651847165486207, 9);
      expect(Math.abs(fine - reference)).toBeLessThan(Math.abs(coarse - reference));
    });

    it('reddens by E(B−V) = A_V / R_V on top of the intrinsic colour', () => {
      const av = dustRaymarchAv([-100, 0, 0], [100, 0, 0], core, P);
      expect(ebvFromAv(av)).toBeCloseTo(av / R_V, 12);
      // An intrinsically blue O star (B−V ≈ −0.30) reddens toward neutral.
      expect(reddenedBv(-0.3, av)).toBeCloseTo(-0.3 + av / R_V, 12);
    });
  });

  it('returns zero for a fully out-of-cube path', () => {
    const av = dustRaymarchAv([2000, 2000, 2000], [3000, 3000, 3000], () => 1, P);
    expect(av).toBe(0);
  });

  it('returns zero for a degenerate zero-length path', () => {
    const av = dustRaymarchAv([10, 10, 10], [10, 10, 10], () => 1, P);
    expect(av).toBe(0);
  });
});

describe('reddening constants', () => {
  it('pins the tap window and global R_V', () => {
    expect(DUST_TAP_PC).toBe(10);
    expect(DUST_TAPS_MIN).toBe(4);
    expect(DUST_TAPS_MAX).toBe(96);
    expect(R_V).toBe(3.1);
  });

  it('E(B−V) = A_V / R_V', () => {
    expect(ebvFromAv(2.742)).toBeCloseTo(0.8845161290322581, 12);
    expect(reddenedBv(-0.3, 2.742)).toBeCloseTo(0.584516129032258, 12);
  });
});
