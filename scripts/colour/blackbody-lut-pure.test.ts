import { describe, expect, it } from 'vitest';
import {
  BV_MAX,
  BV_MIN,
  ballesterosBvFromTeff,
  ballesterosTeff,
  blackbodyToLinearSrgb,
  linearSrgbFromColourIndex,
} from './blackbody-lut-pure';
import { srgbEncode } from '../../src/client/hdr/tonemap-pure';

describe('ballesterosBvFromTeff', () => {
  it.each([
    ['Sol', 5778.42, 0.65],
    ['Sirius A (B-V ≈ 0)', 10125.24, 0.0],
    ['Antares (B-V ≈ 1.83)', ballesterosTeff(1.83), 1.83],
    ['Mintaka (B-V ≈ -0.17)', ballesterosTeff(-0.17), -0.17],
    ['LUT hot end', ballesterosTeff(BV_MIN), BV_MIN],
    ['LUT cool end', ballesterosTeff(BV_MAX), BV_MAX],
  ])('%s: %f K → B-V = %f within 1e-3', (_name, teff, expectedBv) => {
    expect(ballesterosBvFromTeff(teff)).toBeCloseTo(expectedBv, 3);
  });

  it('round-trips a dense B-V sweep within 1e-6', () => {
    for (let bv = -0.4; bv <= 2.0; bv += 0.05) {
      const teff = ballesterosTeff(bv);
      const bvBack = ballesterosBvFromTeff(teff);
      expect(bvBack).toBeCloseTo(bv, 6);
    }
  });
});

describe('blackbodyToLinearSrgb', () => {
  const displayTriplet = (tempK: number): [number, number, number] => {
    const linear = blackbodyToLinearSrgb(tempK);
    return [
      Math.round(srgbEncode(linear[0]) * 255),
      Math.round(srgbEncode(linear[1]) * 255),
      Math.round(srgbEncode(linear[2]) * 255),
    ];
  };

  it('cool red 3000K reads warm orange', () => {
    const [r, g, b] = displayTriplet(3000);
    expect(r).toBe(255);
    expect(g).toBeGreaterThan(150);
    expect(g).toBeLessThan(200);
    expect(b).toBeLessThan(120);
  });

  it('Sol-like 5778K reads near-white', () => {
    const [r, g, b] = displayTriplet(5778);
    expect(r).toBe(255);
    expect(g).toBeGreaterThan(235);
    expect(b).toBeGreaterThan(225);
  });

  it('hot 30000K reads blue-white (Python parity)', () => {
    expect(displayTriplet(30000)).toEqual([162, 187, 255]);
  });

  it('peak-normalises rather than luminance-normalises', () => {
    // The shader divides by Y; a Y-normalised table would run past 1 at
    // the blue end and clip in the uint8 store.
    const hot = blackbodyToLinearSrgb(21707);
    expect(Math.max(...hot)).toBeCloseTo(1, 10);
  });
});

// The seam the volumetric layers take instead of the table. Its agreement
// with the quantised table is what makes "a component's hue and a star's
// are the same function of B-V" true rather than asserted, and that half
// is pinned in blackbody-lut.test.ts, where the table lives.
describe('linearSrgbFromColourIndex', () => {
  it('is the chain composed, not a second implementation of it', () => {
    for (const bv of [-0.3, 0.0, 0.65, 0.9574, 1.5, 1.9]) {
      expect(linearSrgbFromColourIndex(bv)).toEqual(
        blackbodyToLinearSrgb(ballesterosTeff(bv)),
      );
    }
  });

  // Stated as blue/red rather than as a channel: peak-normalisation moves
  // the pinned channel from blue to red as the population cools (red takes
  // over at B-V 0.469, which is also where the table's worst quantisation
  // deviation sits), so no single component is monotonic across the span
  // even though the warmth is.
  it('warms monotonically across the range the layers use', () => {
    let prevRatio = Infinity;
    for (let bv = 0.4; bv <= 1.2; bv += 0.05) {
      const [r, , b] = linearSrgbFromColourIndex(bv);
      expect(b / r).toBeLessThan(prevRatio);
      prevRatio = b / r;
    }
  });
});
