import { describe, it, expect } from 'vitest';
import {
  DR_MAG,
  HIGHLIGHT_DESAT,
  L_THRESH,
  TOE_BLACK_MAG,
  TOE_CURVATURE,
  displayLevel,
  faintToe,
  faintToeInverse,
  inverseTonemapConstant,
  reinhardExtended,
  reinhardExtendedInverse,
  relativeLuminance,
  srgbDecode,
  srgbEncode,
  tonemap,
  tonemapWhitePoint,
  type Rgb,
} from './tonemap-pure';

const LW = tonemapWhitePoint();

describe('tonemapWhitePoint', () => {
  it('puts the shipped defaults at Lw = 20', () => {
    expect(L_THRESH).toBe(0.02);
    expect(DR_MAG).toBe(7.5);
    expect(LW).toBeCloseTo(20, 10);
  });

  it('is one magnitude of range per 10^0.4', () => {
    expect(tonemapWhitePoint(DR_MAG + 2.5)).toBeCloseTo(LW * 10, 8);
  });
});

describe('reinhardExtended', () => {
  it('maps a source DR_MAG brighter than threshold to exactly full white', () => {
    expect(reinhardExtended(LW, LW)).toBeCloseTo(1, 12);
  });

  it('is toe-linear for L far below the white point', () => {
    expect(reinhardExtended(1e-4, LW)).toBeCloseTo(1e-4, 7);
  });

  it('pins the design-doc worked values', () => {
    expect(reinhardExtended(L_THRESH, LW)).toBeCloseTo(0.0196088, 6);
    expect(reinhardExtended(8.0, LW)).toBeCloseTo(0.906667, 6);
    expect(reinhardExtended(30.5, LW)).toBeGreaterThan(1);
  });

  it('is monotonic across the fp16 emission range', () => {
    let prev = 0;
    for (let e = -5; e <= 4; e += 0.25) {
      const y = reinhardExtended(10 ** e, LW);
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
  });
});

describe('faintToe', () => {
  it('is identity at and above the threshold, so the anchor holds', () => {
    for (const y of [L_THRESH, 0.05, 1, 20]) expect(faintToe(y)).toBe(y);
    expect(displayLevel(L_THRESH, LW)).toBeCloseTo(0.15, 3);
  });

  it('lands a source TOE_BLACK_MAG under threshold on half an 8-bit step', () => {
    expect(TOE_BLACK_MAG).toBe(1.5);
    expect(TOE_CURVATURE).toBeCloseTo(1.68874, 5);
    const black = faintToe(L_THRESH * 10 ** (-0.4 * TOE_BLACK_MAG));
    expect(srgbEncode(black) * 255).toBeCloseTo(0.5, 6);
  });

  it('leaves the knee with slope 1, so no isophote marks the threshold', () => {
    const eps = L_THRESH * 1e-6;
    const slope = (faintToe(L_THRESH) - faintToe(L_THRESH - eps)) / eps;
    expect(slope).toBeCloseTo(1, 4);
  });

  it('keeps light just under threshold visible', () => {
    // 0.16 mag under (the anticentre's margin) still reads plainly.
    const y = L_THRESH * 10 ** (-0.4 * 0.16);
    expect(displayLevel(y, LW) * 255).toBeCloseTo(34.4, 1);
  });

  it('is monotonic and continuous through the knee', () => {
    let prev = -1;
    for (let e = -4; e <= 0; e += 0.05) {
      const v = faintToe(L_THRESH * 10 ** e);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    expect(faintToe(L_THRESH * 0.9999999)).toBeCloseTo(L_THRESH, 6);
  });

  it('inverts exactly across the rolloff', () => {
    for (const y of [1e-6, 1e-4, 0.005, 0.0199, L_THRESH, 0.5]) {
      expect(faintToeInverse(faintToe(y))).toBeCloseTo(y, 10);
    }
    expect(faintToeInverse(0)).toBe(0);
  });
});

describe('reinhardExtendedInverse', () => {
  it('inverts the operator across the display range', () => {
    for (const y of [1e-5, 1e-3, 0.02, 0.5, 2, 8, 20]) {
      expect(reinhardExtendedInverse(reinhardExtended(y, LW), LW)).toBeCloseTo(y, 6);
    }
  });

  it('sends full white back to the white point', () => {
    expect(reinhardExtendedInverse(1, LW)).toBeCloseTo(LW, 10);
  });

  it('sends zero to zero', () => {
    expect(reinhardExtendedInverse(0, LW)).toBe(0);
  });
});

describe('srgb transfer pair', () => {
  it('round-trips', () => {
    for (const v of [0, 0.001, 0.0031308, 0.04045, 0.2, 0.5, 1]) {
      expect(srgbDecode(srgbEncode(v))).toBeCloseTo(v, 8);
    }
  });

  it('clamps out-of-range input', () => {
    expect(srgbEncode(-1)).toBe(0);
    expect(srgbEncode(4096)).toBeCloseTo(1, 12);
    expect(srgbDecode(-1)).toBe(0);
    expect(srgbDecode(4096)).toBeCloseTo(1, 12);
  });

  it('puts a threshold star at 0.15 of full scale after encode', () => {
    expect(srgbEncode(reinhardExtended(L_THRESH, LW))).toBeCloseTo(0.150, 3);
  });
});

describe('tonemap', () => {
  it('preserves chromaticity below the desaturation knee', () => {
    for (const hdr of [[0.4, 0.2, 0.1], [2, 1.5, 1]] as Rgb[]) {
      const out = tonemap(hdr, LW);
      expect(srgbDecode(out[0]) / srgbDecode(out[1])).toBeCloseTo(hdr[0] / hdr[1], 6);
      expect(srgbDecode(out[1]) / srgbDecode(out[2])).toBeCloseTo(hdr[1] / hdr[2], 6);
    }
  });

  // A luminance-domain operator sends Y = Lw to output luminance 1, so a
  // chromatic source there necessarily puts its brightest channel over
  // full scale. Per-channel clipping — not the operator — is what breaks
  // hue at the top end, and the reason highlight desaturation exists.
  it('clips the brightest channel of a chromatic source at the white point', () => {
    const hue: Rgb = [0.5, 0.3, 0.2];
    const scale = LW / relativeLuminance(hue);
    const out = tonemap([hue[0] * scale, hue[1] * scale, hue[2] * scale], LW);
    expect(out[0]).toBeCloseTo(1, 12);
    expect(out[2]).toBeLessThan(1);
  });

  it('desaturates toward neutral above the knee', () => {
    const blue: Rgb = [10, 20, 300];
    const out = tonemap(blue, LW);
    const ratio = srgbDecode(out[2]) / srgbDecode(out[0]);
    expect(ratio).toBeLessThan(blue[2] / blue[0]);
    expect(relativeLuminance([srgbDecode(out[0]), srgbDecode(out[1]), srgbDecode(out[2])]))
      .toBeGreaterThan(reinhardExtended(relativeLuminance(blue), LW) * 0.6);
  });

  it('resolves an extreme source to pure white', () => {
    expect(tonemap([300, 600, 9000], LW).every((c) => c > 0.999)).toBe(true);
  });

  it('is gentle on Sirius and saturated on Venus', () => {
    const desat = (l: number) => 1 - Math.exp(-HIGHLIGHT_DESAT * (l / LW - 1));
    expect(desat(30.5)).toBeCloseTo(0.168, 3);
    expect(desat(605)).toBeGreaterThan(0.99);
  });

  it('sends zero and black to black', () => {
    expect(tonemap([0, 0, 0], LW)).toEqual([0, 0, 0]);
  });
});

describe('inverseTonemapConstant', () => {
  it('round-trips every authored chrome colour through the operator', () => {
    const authored: Rgb[] = [
      [0.004, 0.005, 0.006],
      [0.02, 0.02, 0.02],
      [0.1, 0.15, 0.25],
      [0.5, 0.5, 0.5],
      [1, 1, 1],
      [0.9, 0.1, 0.05],
    ];
    for (const linearDisplay of authored) {
      const emission = inverseTonemapConstant(linearDisplay, LW);
      const out = tonemap(emission, LW);
      expect(srgbDecode(out[0])).toBeCloseTo(linearDisplay[0], 5);
      expect(srgbDecode(out[1])).toBeCloseTo(linearDisplay[1], 5);
      expect(srgbDecode(out[2])).toBeCloseTo(linearDisplay[2], 5);
    }
  });

  it('brightens the emission relative to the appearance', () => {
    const [r] = inverseTonemapConstant([0.2, 0.2, 0.2], LW);
    expect(r).toBeGreaterThan(0.2);
  });

  it('sends black to black', () => {
    expect(inverseTonemapConstant([0, 0, 0], LW)).toEqual([0, 0, 0]);
  });
});
