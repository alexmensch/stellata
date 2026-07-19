import { describe, expect, it } from 'vitest';
import { AU_KM, AU_PC, KM_PC } from '../util/astronomy-constants';
import {
  computeDepthSlices,
  DEPTH_BUFFER_BITS,
  depthQuantumPc,
  FAR_MARGIN,
  maxSliceRatio,
  type MemberSphere,
  NEAR_FRACTION,
  NEAR_MIN_PC,
  SLICE_RATIO_SAFETY,
} from './slice-pure';

const FOV_50_RAD = (50 * Math.PI) / 180;
const VIEWPORT_H = 1080;

function sphereKm(distKm: number, radiusKm: number): MemberSphere {
  return { distPc: distKm * KM_PC, radiusPc: radiusKm * KM_PC };
}

describe('maxSliceRatio', () => {
  it('pins the default-view ratio bound (50° / 1080 px)', () => {
    expect(maxSliceRatio(FOV_50_RAD, VIEWPORT_H)).toBeCloseTo(3389.1, 1);
  });

  it('scales with FOV: narrow zoom tightens the bound, wide relaxes it', () => {
    const narrow = maxSliceRatio((10 * Math.PI) / 180, VIEWPORT_H);
    const wide = maxSliceRatio((120 * Math.PI) / 180, VIEWPORT_H);
    expect(narrow).toBeLessThan(maxSliceRatio(FOV_50_RAD, VIEWPORT_H));
    expect(wide / narrow).toBeCloseTo(12, 5);
  });
});

describe('depthQuantumPc — the sub-pixel ordering guarantee', () => {
  it('at a maximal slice far edge, the quantum subtends 1/SAFETY px', () => {
    const near = 1e-9;
    const far = near * maxSliceRatio(FOV_50_RAD, VIEWPORT_H);
    const quantum = depthQuantumPc(far, near, far);
    const quantumAngularRad = quantum / far;
    const pxRad = FOV_50_RAD / VIEWPORT_H;
    expect(quantumAngularRad / pxRad).toBeCloseTo(1 / SLICE_RATIO_SAFETY, 3);
  });

  it('Uranus from Miranda orbit floor: quantum ~6 km ≪ 25,559 km radius', () => {
    // Camera parked at Miranda (surface distance ~330 km, near = 165 km);
    // Uranus centre 129,900 km away — the tightest realistic mesh bracket.
    const near = 330 * KM_PC * NEAR_FRACTION;
    const far = (129_900 + 25_559) * KM_PC * FAR_MARGIN;
    const quantumKm = depthQuantumPc(129_900 * KM_PC, near, far) / KM_PC;
    expect(quantumKm).toBeCloseTo(6.1, 1);
    expect(quantumKm).toBeLessThan(25_559 / 1000);
  });
});

describe('computeDepthSlices', () => {
  it('returns no slices for no members', () => {
    expect(computeDepthSlices([], FOV_50_RAD, VIEWPORT_H)).toEqual([]);
  });

  it('Saturn + rings from Mimas orbit floor fits one slice', () => {
    const spheres = [
      sphereKm(560, 198),          // Mimas
      sphereKm(185_500, 140_000),  // Saturn incl. ring outer edge
    ];
    const slices = computeDepthSlices(spheres, FOV_50_RAD, VIEWPORT_H);
    expect(slices.length).toBe(1);
    expect(slices[0].nearPc).toBeCloseTo(362 * KM_PC * NEAR_FRACTION, 20);
    expect(slices[0].farPc).toBeCloseTo(325_500 * KM_PC * FAR_MARGIN, 18);
  });

  it('stretching the bracket to Titan splits it into two slices', () => {
    const spheres = [
      sphereKm(560, 198),
      sphereKm(185_500, 140_000),
      sphereKm(1_221_900, 2_575),  // Titan
    ];
    expect(computeDepthSlices(spheres, FOV_50_RAD, VIEWPORT_H).length).toBe(2);
  });

  it('full system span (moon floor → Neptune orbit ring) takes 4 slices', () => {
    // The Neptune orbit-ring bound contains the camera, so near floors
    // at NEAR_MIN_PC (its geometry can pass arbitrarily close) — the
    // honest conservative bracket, one slice wider than body-only.
    const spheres = [
      sphereKm(560, 198),                               // Mimas at its orbit floor
      sphereKm(9.54 * AU_KM, 696_000),                  // Sun from Saturn
      { distPc: 9.54 * AU_PC, radiusPc: 30.3 * AU_PC }, // Neptune orbit ring bound
    ];
    const slices = computeDepthSlices(spheres, FOV_50_RAD, VIEWPORT_H);
    expect(slices.length).toBe(4);
    expect(slices[slices.length - 1].nearPc).toBe(NEAR_MIN_PC);
  });

  it('metre-scale probe near Saturn takes 4 slices', () => {
    const spheres: MemberSphere[] = [
      { distPc: 2 * 3.24e-17, radiusPc: 3.24e-17 }, // ~1 m probe, ~2 m away
      sphereKm(185_500, 140_000),                   // Saturn + rings
      { distPc: 9.54 * AU_PC, radiusPc: 30.3 * AU_PC },
    ];
    const slices = computeDepthSlices(spheres, FOV_50_RAD, VIEWPORT_H);
    expect(slices.length).toBe(4);
  });

  it('slices come far→near, contiguous, equal-ratio, each within bound', () => {
    const spheres = [
      { distPc: 2e-12, radiusPc: 1e-12 },
      { distPc: 2e-4, radiusPc: 1e-4 },
    ];
    const slices = computeDepthSlices(spheres, FOV_50_RAD, VIEWPORT_H);
    const rMax = maxSliceRatio(FOV_50_RAD, VIEWPORT_H);
    const ratios = slices.map((s) => s.farPc / s.nearPc);
    for (let i = 0; i < slices.length; i++) {
      expect(ratios[i]).toBeLessThanOrEqual(rMax * (1 + 1e-9));
      expect(ratios[i]).toBeCloseTo(ratios[0], 6);
      if (i > 0) expect(slices[i].farPc).toBeCloseTo(slices[i - 1].nearPc, 12);
    }
    expect(slices[0].farPc).toBeGreaterThan(slices[slices.length - 1].nearPc);
  });

  it('camera inside a member sphere falls back to the near floor', () => {
    // An orbit-ring bounding sphere contains the camera; near must not
    // go non-positive.
    const slices = computeDepthSlices(
      [{ distPc: 1e-5, radiusPc: 2e-5 }],
      FOV_50_RAD,
      VIEWPORT_H,
    );
    expect(slices[slices.length - 1].nearPc).toBe(NEAR_MIN_PC);
  });

  it('depth buffer bits pin the WebGL2 default renderbuffer', () => {
    expect(DEPTH_BUFFER_BITS).toBe(24);
  });
});
