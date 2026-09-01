// Johnson V resolution from Gaia DR3 photometry, printed Hipparcos V,
// Tycho-2's BT/VT and Gliese's printed Vmag. See README.md.

import {
  calibratedPhotometry,
  polynomial,
  type GaiaPhotometry,
} from './gaia-photometry-pure';

/** Riello et al. 2021, A&A 649, A3 — Gaia EDR3 photometric relationships with
 *  other photometric systems, `G − V` as a cubic in `BP − RP`. Ascending
 *  powers. The DR3 photometry is unchanged from EDR3, so the EDR3 calibration
 *  is the one that applies. */
export const RIELLO_G_MINUS_V_COEFFS = [
  -0.02704, 0.01424, -0.2156, 0.01426,
] as const;

/** Published residual scatter of the relation above (mag). Not applied — kept
 *  so a consumer weighing transformed against printed V has the published
 *  uncertainty rather than a guess. */
export const RIELLO_G_MINUS_V_SIGMA = 0.03017;

/** Colour range Riello+ 2021 states the relation over. Outside it the cubic
 *  diverges fast, so this is a validity gate rather than a quality hint. */
export const RIELLO_BP_RP_MIN = -0.5;
export const RIELLO_BP_RP_MAX = 5.0;

/** ESA SP-1200 § 1.3's linear reduction of Tycho `VT` to Johnson `V`,
 *  `V = VT − 0.090·(BT−VT)`. Published over `BT−VT` ∈ [−0.25, 2.0]; nothing
 *  is published above it, which is what {@link tycho2VMagnitude} documents
 *  rather than gates on. */
export const TYCHO2_V_FROM_VT_COEFF = 0.090;
export const TYCHO2_BT_MINUS_VT_MIN = -0.25;
export const TYCHO2_BT_MINUS_VT_MAX = 2.0;

export const V_VIA_VALUES = [
  'gaia_riello',
  'printed_hip',
  'tycho2',
  'gliese',
  'curated',
  'none',
] as const;
export type VVia = (typeof V_VIA_VALUES)[number];

export interface VMagnitudeResolution {
  /** Johnson V, or null when no tier could supply one. */
  v: number | null;
  via: VVia;
}

/** `G − V` from the Riello cubic — the algebra alone, ungated. Callers want
 *  {@link rielloVMagnitude}, which applies the relation's validity range. */
export function rielloGMinusV(bpMinusRp: number): number {
  return polynomial(RIELLO_G_MINUS_V_COEFFS, bpMinusRp);
}

/** Johnson V transformed from a Gaia photometry row, or null when the Riello
 *  relation does not apply to it: a band missing or non-finite, G below the
 *  saturation bound, or the colour outside the published range. */
export function rielloVMagnitude(photometry: GaiaPhotometry | null): number | null {
  const calibrated = calibratedPhotometry(photometry);
  if (calibrated === null) return null;
  const { gMag, bpMinusRp } = calibrated;
  if (bpMinusRp < RIELLO_BP_RP_MIN || bpMinusRp > RIELLO_BP_RP_MAX) return null;
  return gMag - rielloGMinusV(bpMinusRp);
}

export interface Tycho2VResolution {
  /** Johnson V, or null where the row carries fewer than both bands. */
  v: number | null;
  /** Whether `BT−VT` sat outside the range SP-1200 publishes the reduction
   *  over. The transform runs anyway — nothing below this tier could serve
   *  the row, and V is a membership gate, so gating would cost it its record
   *  (README.md § The Tycho-2 tier runs outside its published colour range).
   *  Pinned as `vTycho2OutsideBtVtRange` so an upstream shift is reviewed. */
  outsideRange: boolean;
}

/** Johnson V reduced from a Tycho-2 row's `BT`/`VT`, with the colour-range
 *  verdict the count needs — one read of the two bands, not two. */
export function tycho2VMagnitude(
  btMag: number | null,
  vtMag: number | null,
): Tycho2VResolution {
  if (
    btMag === null || vtMag === null
    || !Number.isFinite(btMag) || !Number.isFinite(vtMag)
  ) {
    return { v: null, outsideRange: false };
  }
  const colour = btMag - vtMag;
  return {
    v: vtMag - TYCHO2_V_FROM_VT_COEFF * colour,
    outsideRange:
      colour < TYCHO2_BT_MINUS_VT_MIN || colour > TYCHO2_BT_MINUS_VT_MAX,
  };
}

/** V through the cascade: Riello-transformed Gaia photometry, else the printed
 *  Hipparcos V, else Tycho-2's reduced `VT`, else Gliese's printed `Vmag`,
 *  else curated. Tier rationale — why the bright tier is a condition rather
 *  than a magnitude cut, and why there is no SIMBAD tier — in README.md
 *  § The V cascade. */
export function resolveVMagnitude(
  photometry: GaiaPhotometry | null,
  printedV: number | null,
  tychoV: number | null,
  glieseV: number | null,
  curatedV: number | null = null,
): VMagnitudeResolution {
  const transformed = rielloVMagnitude(photometry);
  if (transformed !== null) {
    return { v: transformed, via: 'gaia_riello' };
  }
  if (printedV !== null && Number.isFinite(printedV)) {
    return { v: printedV, via: 'printed_hip' };
  }
  if (tychoV !== null && Number.isFinite(tychoV)) {
    return { v: tychoV, via: 'tycho2' };
  }
  if (glieseV !== null && Number.isFinite(glieseV)) {
    return { v: glieseV, via: 'gliese' };
  }
  // Sol only: it carries no identifier any tier above can key on, and V is a
  // membership gate. See `SOL_APPARENT_V_MAGNITUDE`.
  if (curatedV !== null && Number.isFinite(curatedV)) {
    return { v: curatedV, via: 'curated' };
  }
  return { v: null, via: 'none' };
}

/** Whether a V from this tier is the whole SYSTEM's blended magnitude — every
 *  component the source catalogue failed to resolve, summed into one value.
 *  True for the three printed tiers; `null` is a record no cascade ran on (a
 *  minted companion), per-component by construction. Which tiers blend and
 *  why: README.md § Which tiers give a system blend.
 *
 *  Subtracting a companion's flux from a record double-counts unless gated on
 *  this — ../companions/README.md § Anchor flux conservation. */
export function vTierIsSystemBlend(via: VVia | null): boolean {
  return via === 'printed_hip' || via === 'tycho2' || via === 'gliese';
}
