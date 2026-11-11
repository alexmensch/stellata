// A component's absolute V and B−V from its own Gaia DR3 photometry and parallax. See README.md#gaia-photometry.

import { BV_MAX, BV_MIN, ballesterosBvFromTeff } from '../../../src/astro-core/colour/blackbody-lut-pure';
import { polynomial } from '../../catalog/photometry/gaia-photometry-pure';
import { RIELLO_BP_RP_MAX, RIELLO_BP_RP_MIN, rielloGMinusV } from '../../catalog/photometry/v-magnitude-pure';
import type { GaiaAstrometryRow } from '../load/gaia-pure';

/** Montalto 2021 (/data/papers/index.md#montalto2021) eq. 4: Teff as a
 *  quintic in BP − RP, ascending powers, valid over the range below. Fed the
 *  observed colour, not the paper's de-reddened one:
 *  /docs/science-multiple-star-pipeline.md#catalog-side-binary-detection. */
export const MONTALTO_BPRP_TEFF_COEFFS = [9453.14, -6859.40, 3542.16, -1053.09, 165.635, -10.5672] as const;
export const MONTALTO_BP_RP_MIN = 0.5;
export const MONTALTO_BP_RP_MAX = 5.0;

export interface GaiaPhotometryEstimate {
  readonly absmag: number;
  /** Null without both BP and RP, or with BP − RP outside Montalto's range. */
  readonly ci: number | null;
}

/** Null without a G magnitude or a positive parallax. Without BP and RP the
 *  absmag is M_G itself. */
export function gaiaPhotometryAbsmagCi(gaia: GaiaAstrometryRow): GaiaPhotometryEstimate | null {
  if (gaia.gMag === null || gaia.parallaxMas === null || gaia.parallaxMas <= 0) return null;
  const absG = gaia.gMag + 5.0 * Math.log10(gaia.parallaxMas) - 10.0;
  if (gaia.bpMag === null || gaia.rpMag === null) return { absmag: absG, ci: null };
  const bpRp = gaia.bpMag - gaia.rpMag;
  // Clamped into Riello's range, not refused as rielloVMagnitude would: README.md#gaia-photometry.
  const absmag = absG - rielloGMinusV(Math.min(Math.max(bpRp, RIELLO_BP_RP_MIN), RIELLO_BP_RP_MAX));
  if (bpRp < MONTALTO_BP_RP_MIN || bpRp > MONTALTO_BP_RP_MAX) return { absmag, ci: null };
  const teff = polynomial(MONTALTO_BPRP_TEFF_COEFFS, bpRp);
  return { absmag, ci: Math.min(Math.max(ballesterosBvFromTeff(teff), BV_MIN), BV_MAX) };
}
