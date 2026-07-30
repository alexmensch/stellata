import { describe, it, expect } from 'vitest';
import { equirectMeanLinearLuminance } from './map-mean-luminance';
import { relativeLuminance, srgbDecode } from '../../hdr/tonemap-pure';

/** Equirect RGBA where every pixel takes the same byte triple. */
function flat(width: number, height: number, rgb: [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = rgb[0];
    out[i * 4 + 1] = rgb[1];
    out[i * 4 + 2] = rgb[2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

describe('equirectMeanLinearLuminance', () => {
  it('returns the decoded luminance of a uniform map', () => {
    const mean = equirectMeanLinearLuminance(flat(8, 4, [128, 128, 128]), 8, 4);
    expect(mean).toBeCloseTo(srgbDecode(128 / 255), 12);
  });

  it('decodes before averaging, not after', () => {
    // Half black, half mid-grey by column. sRGB decode is convex, so the mean
    // of the decoded values sits ABOVE the decode of the averaged byte —
    // averaging encoded bytes first understates the linear mean, and since
    // this mean divides the surface scale, that would render every textured
    // body too bright.
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 128, 128, 128, 255]);
    const mean = equirectMeanLinearLuminance(rgba, 2, 1);
    expect(mean).toBeCloseTo(srgbDecode(128 / 255) / 2, 12);
    expect(mean).toBeGreaterThan(srgbDecode(64 / 255));
  });

  it('weights rows by cos(latitude) — polar rows cannot outvote the equator', () => {
    // Two-row map: a bright band at mid-latitude in one hemisphere. Equal
    // cos-weights there, so the mean is the plain average; the point is that a
    // map whose poles are bright does NOT read as bright overall.
    const h = 64;
    const w = 2;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
      // Bright only in the top and bottom 4 rows (the compressed polar caps).
      const polar = row < 4 || row >= h - 4;
      for (let col = 0; col < w; col++) {
        const i = (row * w + col) * 4;
        const v = polar ? 255 : 0;
        rgba[i] = v;
        rgba[i + 1] = v;
        rgba[i + 2] = v;
        rgba[i + 3] = 255;
      }
    }
    const mean = equirectMeanLinearLuminance(rgba, w, h);
    // 8 of 64 rows are white; unweighted that would be 0.125. cos-weighting
    // the polar caps drops their contribution by well over half.
    expect(mean).toBeGreaterThan(0);
    expect(mean).toBeLessThan(0.05);
  });

  it('uses Rec.709 luma — a green map reads far brighter than a blue one', () => {
    const green = equirectMeanLinearLuminance(flat(4, 2, [0, 255, 0]), 4, 2);
    const blue = equirectMeanLinearLuminance(flat(4, 2, [0, 0, 255]), 4, 2);
    expect(green).toBeCloseTo(relativeLuminance([0, 1, 0]), 12);
    expect(green / blue).toBeCloseTo(0.7152 / 0.0722, 6);
  });

  it('returns 0 for an empty map rather than NaN', () => {
    expect(equirectMeanLinearLuminance(new Uint8ClampedArray(0), 0, 0)).toBe(0);
  });
});
