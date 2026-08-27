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

/** Johnson V reduced from a Tycho-2 row's `BT`/`VT`, or null where the row
 *  carries only one of the two bands.
 *
 *  **Ungated, deliberately.** The relation is published over `BT−VT` ∈
 *  [−0.25, 2.0] and 5 of the 123 rows this tier serves sit outside it (four
 *  red, to 2.69; one blue at −0.282), where the linear form runs ~0.19–0.24
 *  mag bright against the cell it replaces. Gating there would not hand those
 *  rows to a better tier — none of the five carries a `gl`, so no tier is
 *  below them — it would cost each its only V and so its record, since V is a
 *  membership gate. The ci cascade refuses the analogous extrapolation
 *  because it HAS tiers underneath (README.md § Where the colour bound comes
 *  from); this one does not, and the extrapolation is bounded and counted
 *  (`vTycho2OutsideBtVtRange`) instead of hidden. */
export function tycho2VMagnitude(
  btMag: number | null,
  vtMag: number | null,
): number | null {
  if (btMag === null || vtMag === null) return null;
  if (!Number.isFinite(btMag) || !Number.isFinite(vtMag)) return null;
  return vtMag - TYCHO2_V_FROM_VT_COEFF * (btMag - vtMag);
}

/** Whether a Tycho-2 colour sits outside the range SP-1200 publishes the
 *  reduction over. Nothing routes on it — {@link tycho2VMagnitude} explains
 *  why — but the population is pinned so an upstream shift is reviewed. */
export function tycho2ColourOutsideRange(
  btMag: number | null,
  vtMag: number | null,
): boolean {
  if (btMag === null || vtMag === null) return false;
  const colour = btMag - vtMag;
  return colour < TYCHO2_BT_MINUS_VT_MIN || colour > TYCHO2_BT_MINUS_VT_MAX;
}

/** V through the cascade: Riello-transformed Gaia photometry, else the printed
 *  Hipparcos V, else Tycho-2's reduced `VT`, else Gliese's printed `Vmag`.
 *  `docs/catalog-driver.md` § 5.
 *
 *  The bright rescue tier is the `printed_hip` branch — saturated, missing or
 *  out-of-range Gaia photometry all land there, so it is condition-driven
 *  rather than a magnitude cut applied from outside.
 *
 *  **Gliese sits above no SIMBAD tier because it needs none.** It reaches
 *  every one of the 16 rows Tycho-2 misses, and SIMBAD holds no V flux at all
 *  for the 9 of those its own cascade would otherwise have been asked for — so
 *  the § 5 rule that a SIMBAD tier serves only cohorts no first-order
 *  catalogue reaches leaves it with nothing to serve here. */
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
 *  True for the printed tiers, which carry one magnitude per catalogue entry
 *  and hold a close pair as one entry. `gaia_riello` is not: Gaia deblends much
 *  of the sub-arcsec population into per-component sources, so a G-derived V
 *  may already exclude a companion. `null` is a record no cascade ran on (a
 *  minted companion), whose magnitude is per-component by construction.
 *  Subtracting a companion's flux from a record double-counts unless gated on
 *  this — see ../companions/README.md § Anchor flux conservation.
 *
 *  `tycho2` and `gliese` are printed tiers on the same terms, and each has its
 *  own reason beyond that: a Tycho-2 `pflag='P'` row's photometry is an
 *  unresolved double's photocentre, and a Gliese cell naming a component the
 *  catalogue never resolved falls back to the system entry (`Gl 165A` reads
 *  the `Gl 165 AB` row). */
export function vTierIsSystemBlend(via: VVia | null): boolean {
  return via === 'printed_hip' || via === 'tycho2' || via === 'gliese';
}
