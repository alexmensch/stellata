// Patch code values for the display-calibration surface: the black-point
// and highlight ladders, the grey wedge, and the gamma match points.
// See src/client/calibration/README.md.

/** Near-black patches on a code-0 field. Spaced so each is a visible
 *  step at the bottom of the transfer rather than an even code interval. */
export const BLACK_POINT_CODES = [1, 2, 3, 4, 6, 8, 11, 16] as const;

/** Near-white patches on a code-255 field, mirroring the black ladder. */
export const HIGHLIGHT_CODES = [238, 243, 247, 250, 252, 254] as const;

export const HIGHLIGHT_SURROUND_CODE = 255;

export const GREY_WEDGE_STEPS = 16;

/** Gamma values the match patches are cut for. */
export const GAMMA_STOPS = [1.8, 2.0, 2.2, 2.4, 2.6] as const;

/** The transfer the tone-map's sRGB encode targets — the stop a correctly
 *  behaving display should land on. */
export const ASSUMED_DISPLAY_GAMMA = 2.2;

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

export function greyCss(code: number): string {
  return `rgb(${code}, ${code}, ${code})`;
}
