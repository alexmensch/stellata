import { describe, it, expect } from 'vitest';
import {
  BLACK_POINT_CODES,
  GAMMA_STOPS,
  GREY_WEDGE_STEPS,
  HIGHLIGHT_CODES,
  HIGHLIGHT_SURROUND_CODE,
  MAX_CODE,
  gammaCells,
  gammaMatchCode,
  greyCss,
  greyWedgeCodes,
  srgbMatchCode,
} from './calibration-ladders-pure';
import { srgbDecode } from '../hdr/tonemap-pure';

describe('black-point ladder', () => {
  it('starts one code value above black and stays in the shadow toe', () => {
    expect(BLACK_POINT_CODES[0]).toBe(1);
    expect(BLACK_POINT_CODES[BLACK_POINT_CODES.length - 1]).toBe(16);
  });

  it('increases strictly, so a merged pair reads as display crush', () => {
    for (let i = 1; i < BLACK_POINT_CODES.length; i++) {
      expect(BLACK_POINT_CODES[i]).toBeGreaterThan(BLACK_POINT_CODES[i - 1]);
    }
  });
});

describe('highlight ladder', () => {
  it('sits below the surround so every patch is a step down from white', () => {
    expect(HIGHLIGHT_SURROUND_CODE).toBe(MAX_CODE);
    for (const c of HIGHLIGHT_CODES) expect(c).toBeLessThan(HIGHLIGHT_SURROUND_CODE);
    expect(HIGHLIGHT_CODES[HIGHLIGHT_CODES.length - 1]).toBe(254);
  });

  it('increases strictly', () => {
    for (let i = 1; i < HIGHLIGHT_CODES.length; i++) {
      expect(HIGHLIGHT_CODES[i]).toBeGreaterThan(HIGHLIGHT_CODES[i - 1]);
    }
  });
});

describe('greyWedgeCodes', () => {
  it('spans the full range endpoint to endpoint', () => {
    const codes = greyWedgeCodes();
    expect(codes).toHaveLength(GREY_WEDGE_STEPS);
    expect(codes[0]).toBe(0);
    expect(codes[codes.length - 1]).toBe(255);
  });

  it('pins the shipped 16-step wedge', () => {
    expect(greyWedgeCodes()).toEqual([
      0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255,
    ]);
  });

  it('honours a caller-supplied step count', () => {
    expect(greyWedgeCodes(3)).toEqual([0, 128, 255]);
  });
});

describe('gammaMatchCode', () => {
  it('pins the shipped stops', () => {
    expect(GAMMA_STOPS.map(gammaMatchCode)).toEqual([174, 180, 186, 191, 195]);
  });

  it('inverts to the 0.5 linear luminance a 50/50 pattern averages to', () => {
    for (const gamma of GAMMA_STOPS) {
      const linear = Math.pow(gammaMatchCode(gamma) / MAX_CODE, gamma);
      expect(linear).toBeCloseTo(0.5, 2);
    }
  });

  it('rises with gamma, so the stops stay discriminable and ordered', () => {
    const codes = GAMMA_STOPS.map(gammaMatchCode);
    for (let i = 1; i < codes.length; i++) {
      expect(codes[i]).toBeGreaterThan(codes[i - 1]);
    }
  });

});

describe('srgbMatchCode', () => {
  it('pins the reference patch', () => {
    expect(srgbMatchCode()).toBe(188);
  });

  it('round-trips through the shipped decode to 0.5 linear', () => {
    expect(srgbDecode(srgbMatchCode() / MAX_CODE)).toBeCloseTo(0.5, 2);
  });

  it('is not any power-law stop — marking one as the target misreports', () => {
    const powerLaw = GAMMA_STOPS.map(gammaMatchCode);
    expect(powerLaw).not.toContain(srgbMatchCode());
  });

  it('lands between the 2.2 and 2.4 stops', () => {
    expect(srgbMatchCode()).toBeGreaterThan(gammaMatchCode(2.2));
    expect(srgbMatchCode()).toBeLessThan(gammaMatchCode(2.4));
  });
});

describe('gammaCells', () => {
  it('interleaves the reference into the power-law scale, ascending', () => {
    const cells = gammaCells();
    expect(cells).toHaveLength(GAMMA_STOPS.length + 1);
    expect(cells.map((c) => c.code)).toEqual([174, 180, 186, 188, 191, 195]);
    expect(cells.map((c) => c.label)).toEqual([
      '1.8', '2.0', '2.2', 'sRGB', '2.4', '2.6',
    ]);
  });

  it('marks exactly one cell as the reference, and it is the sRGB one', () => {
    const refs = gammaCells().filter((c) => c.isReference);
    expect(refs).toHaveLength(1);
    expect(refs[0].code).toBe(srgbMatchCode());
  });
});

describe('greyCss', () => {
  it('emits a neutral triple', () => {
    expect(greyCss(0)).toBe('rgb(0, 0, 0)');
    expect(greyCss(186)).toBe('rgb(186, 186, 186)');
  });
});
