import { describe, expect, it } from 'vitest';
import { CAMERA_FAR_PC } from '../../../../scripts/local-group/build-local-group-pure';
import { CAMERA_NEAR_PC, FOV_MIN_DEG } from '../../camera/timing';
import { AU_KM, AU_PC, KM_PC } from '../../util/astronomy-constants';
import {
  computeBracket,
  computeDepthSlices,
  DEPTH_BUFFER_BITS,
  depthQuantumPc,
  FAR_MARGIN,
  maxSliceRatio,
  type MemberSphere,
  NEAR_FRACTION,
  NEAR_MIN_PC,
  REVERSED_DEPTH_MANTISSA_BITS,
  reversedDepthQuantumPc,
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

describe('computeBracket — the K = 1 reversed-z render range', () => {
  it('returns null for no members', () => {
    expect(computeBracket([])).toBeNull();
  });

  it('applies the near fraction, far margin, and near floor', () => {
    const bracket = computeBracket([
      sphereKm(560, 198),
      sphereKm(185_500, 140_000),
    ])!;
    expect(bracket.nearPc).toBeCloseTo(362 * KM_PC * NEAR_FRACTION, 20);
    expect(bracket.farPc).toBeCloseTo(325_500 * KM_PC * FAR_MARGIN, 18);
    expect(computeBracket([{ distPc: 1e-5, radiusPc: 2e-5 }])!.nearPc).toBe(NEAR_MIN_PC);
  });

  it('spans exactly what the sliced partition spans — one range, two encodings', () => {
    const spheres = [
      { distPc: 2 * 3.24e-17, radiusPc: 3.24e-17 },
      sphereKm(185_500, 140_000),
      { distPc: 9.54 * AU_PC, radiusPc: 30.3 * AU_PC },
    ];
    const bracket = computeBracket(spheres)!;
    const slices = computeDepthSlices(spheres, FOV_50_RAD, VIEWPORT_H);
    expect(bracket.farPc / slices[0].farPc).toBeCloseTo(1, 12);
    expect(bracket.nearPc).toBe(slices[slices.length - 1].nearPc);
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

const M_PER_PC = (1 / KM_PC) * 1000;
const metres = (pc: number) => pc * M_PER_PC;
const km = (pc: number) => pc / KM_PC;

/** Reversed finite-far depth as the GPU computes it: the projection's
 *  z-row in float32, divided by w. Models the cancellation the closed-form
 *  bound omits. */
function depthF32(zPc: number, nearPc: number, farPc: number): number {
  const f = Math.fround;
  const p22 = f(-nearPc / (farPc - nearPc));
  const p23 = f((nearPc * farPc) / (farPc - nearPc));
  return f(f(p22 * f(-zPc)) + p23) / f(zPc);
}

/** Smallest Δz at `zPc` that moves the stored float32 depth — the quantum
 *  actually realised, cancellation included. */
function realisedQuantumPc(zPc: number, nearPc: number, farPc: number): number {
  const d0 = depthF32(zPc, nearPc, farPc);
  let lo = zPc;
  let hi = zPc * 1.0000001;
  for (let i = 0; i < 500 && depthF32(hi, nearPc, farPc) === d0; i++) hi *= 1.0000001;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (depthF32(mid, nearPc, farPc) === d0) lo = mid;
    else hi = mid;
  }
  return hi - zPc;
}

describe('reversedDepthQuantumPc — the ratio-free WebGPU bound', () => {
  it('pins the float32 mantissa bits behind the bound', () => {
    expect(REVERSED_DEPTH_MANTISSA_BITS).toBe(23);
  });

  it('is free of near and of far/near — the property that retires slicing', () => {
    const z = 1e-8;
    const wide = reversedDepthQuantumPc(z, CAMERA_FAR_PC);
    for (const near of [1e-17, 1e-12, 1e-6]) {
      // near never enters the expression; assert it via the sliced sibling,
      // which swings by orders of magnitude over the same brackets.
      expect(reversedDepthQuantumPc(z, CAMERA_FAR_PC)).toBe(wide);
      expect(depthQuantumPc(z, near, CAMERA_FAR_PC)).not.toBeCloseTo(wide, 30);
    }
    expect(wide / z).toBeCloseTo(2 ** -23, 12);
  });

  it('pins the headline scenarios at the main pass own planes', () => {
    const at = (zPc: number) => reversedDepthQuantumPc(zPc, CAMERA_FAR_PC);
    expect(metres(at(185_500 * KM_PC))).toBeCloseTo(22.1, 1); // Saturn from Mimas
    expect(metres(at(129_900 * KM_PC))).toBeCloseTo(15.5, 1); // Uranus from Miranda
    expect(metres(at(2 * 3.24e-17)) * 1e9).toBeCloseTo(238, 0); // probe at its park, nm
    expect(km(at(FAR_MARGIN * (9.54 + 30.3) * AU_PC))).toBeCloseTo(746, 0); // Neptune ring
  });

  it('the probe park sits inside the main-pass near plane — the new binding constraint', () => {
    expect(2 * 3.24e-17).toBeLessThan(CAMERA_NEAR_PC);
    expect(km(CAMERA_NEAR_PC)).toBeCloseTo(30.9, 1);
  });

  it('clears the ¼-px criterion by ~339x at the tightest FOV the app allows', () => {
    const pxRad = ((FOV_MIN_DEG * Math.PI) / 180) / VIEWPORT_H;
    const quantumPx = 2 ** -23 / pxRad;
    expect(quantumPx).toBeCloseTo(7.4e-4, 5);
    expect(Math.round(1 / SLICE_RATIO_SAFETY / quantumPx)).toBe(339);
  });

  it('is ~1700x tighter than the sliced 24-bit guarantee', () => {
    const sliced = maxSliceRatio(FOV_50_RAD, VIEWPORT_H) / 2 ** DEPTH_BUFFER_BITS;
    expect(sliced).toBeCloseTo(2.02e-4, 6);
    expect(Math.round(sliced / 2 ** -23)).toBe(1695);
  });

  it('the bound survives the cancellation it does not model, across a 2e13 bracket', () => {
    // The extreme local bracket: probe near floor → Neptune's orbit ring.
    const near = NEAR_MIN_PC;
    const far = FAR_MARGIN * (9.54 + 30.3) * AU_PC;
    expect(far / near).toBeGreaterThan(1e13);

    let worst = 0;
    let best = Infinity;
    for (const frac of [1e-13, 1e-9, 1e-6, 1e-3, 0.1, 0.5, 0.9, 0.99]) {
      const z = far * frac;
      const rel = realisedQuantumPc(z, near, far) / z;
      worst = Math.max(worst, rel);
      best = Math.min(best, rel);
    }
    // Realised resolution never breaches the headline bound anywhere.
    expect(worst).toBeLessThan(2 ** -23);
    expect(worst).toBeCloseTo(7.4e-8, 9);
    expect(best).toBeCloseTo(5.5e-9, 10);
  });

  it('cancellation, not storage, dominates at the far end — the (1 − z/f) term does not survive', () => {
    const near = NEAR_MIN_PC;
    const far = FAR_MARGIN * (9.54 + 30.3) * AU_PC;
    const z = 0.9 * far;
    const realised = realisedQuantumPc(z, near, far);
    // Storage alone would predict the quantum collapsing toward the far
    // plane; the projection's own float32 cancellation holds it up instead.
    expect(realised / reversedDepthQuantumPc(z, far)).toBeGreaterThan(3);
    expect(realised / z).toBeLessThan(2 ** -23);
  });
});

describe('reversed-z vs sliced at the pinned vantages — the decision table', () => {
  const gainAt = (zPc: number, spheres: MemberSphere[]) => {
    const slices = computeDepthSlices(spheres, FOV_50_RAD, VIEWPORT_H);
    const hit = slices.find((s) => zPc >= s.nearPc && zPc <= s.farPc) ?? slices[0];
    return {
      k: slices.length,
      sliced: depthQuantumPc(zPc, hit.nearPc, hit.farPc),
      reversed: reversedDepthQuantumPc(zPc, CAMERA_FAR_PC),
    };
  };
  const NEPTUNE_RING: MemberSphere = { distPc: 9.54 * AU_PC, radiusPc: 30.3 * AU_PC };
  const SATURN = sphereKm(185_500, 140_000);
  const MIMAS = sphereKm(560, 198);

  it('Saturn from Mimas floor: 11.3 km sliced → 22 m reversed (512x)', () => {
    const g = gainAt(185_500 * KM_PC, [MIMAS, SATURN]);
    expect(g.k).toBe(1);
    expect(km(g.sliced)).toBeCloseTo(11.3, 1);
    expect(Math.round(g.sliced / g.reversed)).toBe(512);
  });

  it('Uranus from Miranda floor: 6.1 km sliced → 15.5 m reversed (393x)', () => {
    const g = gainAt(129_900 * KM_PC, [
      { distPc: 330 * KM_PC, radiusPc: 0 },
      sphereKm(129_900, 25_559),
    ]);
    expect(km(g.sliced)).toBeCloseTo(6.1, 1);
    expect(Math.round(g.sliced / g.reversed)).toBe(393);
  });

  it('probe at its park: only 3.2x — standard depth near its own near plane was already good', () => {
    const g = gainAt(2 * 3.24e-17, [
      { distPc: 2 * 3.24e-17, radiusPc: 3.24e-17 },
      SATURN,
      NEPTUNE_RING,
    ]);
    expect(g.k).toBe(4);
    expect(g.sliced / g.reversed).toBeCloseTo(3.2, 1);
  });

  it('Neptune ring at the bracket far: 791,000 km sliced → 746 km reversed (1060x)', () => {
    const g = gainAt(FAR_MARGIN * (9.54 + 30.3) * AU_PC, [
      MIMAS,
      sphereKm(9.54 * AU_KM, 696_000),
      NEPTUNE_RING,
    ]);
    expect(g.k).toBe(4);
    expect(km(g.sliced) / 1000).toBeCloseTo(791, 0);
    expect(Math.round(g.sliced / g.reversed)).toBe(1061);
  });
});
