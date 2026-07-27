// Extended-Reinhard tone-map operator, its exact inverse, and the sRGB
// transfer pair. CPU mirror of tonemap.glsl — see README.md § Operator.

export type Rgb = readonly [number, number, number];

export const L_THRESH = 0.02;
export const DR_MAG = 7.5;
export const HIGHLIGHT_DESAT = 0.35;
export const LUMA_WEIGHTS: Rgb = [0.2126, 0.7152, 0.0722];

const SRGB_ENCODE_KNEE = 0.0031308;
const SRGB_DECODE_KNEE = 0.04045;

export function tonemapWhitePoint(drMag = DR_MAG, lThresh = L_THRESH): number {
  return lThresh * 10 ** (0.4 * drMag);
}

export function relativeLuminance(rgb: Rgb): number {
  return (
    rgb[0] * LUMA_WEIGHTS[0] + rgb[1] * LUMA_WEIGHTS[1] + rgb[2] * LUMA_WEIGHTS[2]
  );
}

export function reinhardExtended(y: number, whitePoint: number): number {
  return (y * (1 + y / (whitePoint * whitePoint))) / (1 + y);
}

/** Non-negative root of `reinhardExtended(y, whitePoint) = yd`. */
export function reinhardExtendedInverse(yd: number, whitePoint: number): number {
  const w2 = whitePoint * whitePoint;
  return 0.5 * w2 * (yd - 1 + Math.sqrt((1 - yd) * (1 - yd) + (4 * yd) / w2));
}

export function srgbEncode(c: number): number {
  const v = Math.min(Math.max(c, 0), 1);
  return v < SRGB_ENCODE_KNEE ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

export function srgbDecode(c: number): number {
  const v = Math.min(Math.max(c, 0), 1);
  return v < SRGB_DECODE_KNEE ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Linear HDR luminance → display sRGB, hue-preserving. Mirrors
 *  `stellataTonemapUndithered`: the dither is 8-bit quantisation noise
 *  applied after the operator, not part of it. */
export function tonemap(hdr: Rgb, whitePoint: number, desat = HIGHLIGHT_DESAT): Rgb {
  const y = relativeLuminance(hdr);
  if (y <= 0) return [0, 0, 0];
  const yd = reinhardExtended(y, whitePoint);
  const white = 1 - Math.exp(-desat * Math.max(y / whitePoint - 1, 0));
  const chroma = (yd / y) * (1 - white);
  return [
    srgbEncode(hdr[0] * chroma + yd * white),
    srgbEncode(hdr[1] * chroma + yd * white),
    srgbEncode(hdr[2] * chroma + yd * white),
  ];
}

/** Emission whose tone-mapped, pre-encode value is `linearDisplay` — what
 *  a non-physical chrome layer must write to come out of the pass at its
 *  authored appearance. Exact for every authored colour: a display
 *  luminance ≤ 1 lands at or below the desaturation knee, where `tonemap`
 *  is pure luminance scaling. */
export function inverseTonemapConstant(linearDisplay: Rgb, whitePoint: number): Rgb {
  const yd = relativeLuminance(linearDisplay);
  if (yd <= 0) return [0, 0, 0];
  const scale = reinhardExtendedInverse(yd, whitePoint) / yd;
  return [
    linearDisplay[0] * scale,
    linearDisplay[1] * scale,
    linearDisplay[2] * scale,
  ];
}
