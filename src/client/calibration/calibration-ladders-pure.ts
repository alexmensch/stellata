// Patch code values for the display-calibration surface: the black-point
// and highlight ladders, the grey wedge, and the gamma match points.
// See src/client/calibration/README.md.

import { srgbEncode } from '../hdr/tonemap/tonemap-pure';

/** Near-black patches on a code-0 field. Spaced so each is a visible
 *  step at the bottom of the transfer rather than an even code interval. */
export const BLACK_POINT_CODES = [1, 2, 3, 4, 6, 8, 11, 16] as const;

/** Near-white patches on a code-255 field, mirroring the black ladder. */
export const HIGHLIGHT_CODES = [238, 243, 247, 250, 252, 254] as const;

export const HIGHLIGHT_SURROUND_CODE = 255;

export const GREY_WEDGE_STEPS = 16;

/** Pure-power-law gammas the match patches are cut for — a scale for
 *  reading how far a display sits from the reference, not targets. */
export const GAMMA_STOPS = [1.8, 2.0, 2.2, 2.4, 2.6] as const;

export const MAX_CODE = 255;

export function greyWedgeCodes(steps: number = GREY_WEDGE_STEPS): number[] {
  return Array.from({ length: steps }, (_, i) =>
    Math.round((i * MAX_CODE) / (steps - 1)),
  );
}

/** Code value whose linear luminance equals the 0.5 that a 50/50 black-white
 *  pattern averages to, on a display of the given gamma: (C/255)^γ = 0.5. */
export function gammaMatchCode(gamma: number): number {
  return Math.round(MAX_CODE * Math.pow(0.5, 1 / gamma));
}

/** The match point for a display behaving exactly as the output transfer
 *  assumes. Derived from the shipped encode rather than a power-law
 *  approximation of it: sRGB is a 2.4 exponent on a shifted curve with a
 *  linear toe, so its match lands between the 2.2 and 2.4 stops and equals
 *  neither. Marking a power-law stop as the target misreports. */
export function srgbMatchCode(): number {
  return Math.round(MAX_CODE * srgbEncode(0.5));
}

export interface GammaCell {
  code: number;
  label: string;
  /** The stop a correctly behaving display should match. */
  isReference: boolean;
}

/** The gamma row, ascending by code value — the power-law scale with the
 *  sRGB reference interleaved at its true position. */
export function gammaCells(): GammaCell[] {
  const cells: GammaCell[] = GAMMA_STOPS.map((gamma) => ({
    code: gammaMatchCode(gamma),
    label: gamma.toFixed(1),
    isReference: false,
  }));
  cells.push({ code: srgbMatchCode(), label: 'sRGB', isReference: true });
  return cells.sort((a, b) => a.code - b.code);
}

export function greyCss(code: number): string {
  return `rgb(${code}, ${code}, ${code})`;
}
