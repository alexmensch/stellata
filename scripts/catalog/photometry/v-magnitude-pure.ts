// Johnson V resolution from Gaia DR3 photometry, printed Hipparcos V, and
// the catalogue's own printed cell. See README.md.

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

/** Gaia's CCD response saturates on the brightest sources, so `phot_g_mean_mag`
 *  below this bound is systematically unreliable and the printed tier takes
 *  over regardless of colour. Calibrated against the printed-vs-transformed
 *  |ΔV| distribution — see README.md § Where the validity bound comes from. */
export const GAIA_PHOTOMETRY_SATURATION_G = 4.0;

export const V_VIA_VALUES = [
  'gaia_riello',
  'printed_hip',
  'catalogued',
  'none',
] as const;
export type VVia = (typeof V_VIA_VALUES)[number];

export interface VMagnitudeResolution {
  /** Johnson V, or null when no tier could supply one. */
  v: number | null;
  via: VVia;
}

export interface GaiaPhotometry {
  gMag: number | null;
  bpMag: number | null;
  rpMag: number | null;
}

/** `G − V` from the Riello cubic. Callers gate on
 *  {@link isRielloTransformable} first; this is the algebra alone. */
export function rielloGMinusV(bpMinusRp: number): number {
  let gMinusV = 0;
  for (let i = RIELLO_G_MINUS_V_COEFFS.length - 1; i >= 0; i--) {
    gMinusV = gMinusV * bpMinusRp + RIELLO_G_MINUS_V_COEFFS[i];
  }
  return gMinusV;
}

/** Whether the Riello relation applies: all three bands present, G above the
 *  saturation bound, and the colour inside the published range. */
export function isRielloTransformable(photometry: GaiaPhotometry | null): boolean {
  if (!photometry) return false;
  const { gMag, bpMag, rpMag } = photometry;
  if (gMag === null || bpMag === null || rpMag === null) return false;
  if (!Number.isFinite(gMag) || !Number.isFinite(bpMag) || !Number.isFinite(rpMag)) {
    return false;
  }
  if (gMag < GAIA_PHOTOMETRY_SATURATION_G) return false;
  const bpMinusRp = bpMag - rpMag;
  return bpMinusRp >= RIELLO_BP_RP_MIN && bpMinusRp <= RIELLO_BP_RP_MAX;
}

/** V through the cascade: Riello-transformed Gaia photometry, else the printed
 *  Hipparcos V, else the catalogued cell. `docs/catalog-driver.md` § 5.
 *
 *  The bright rescue tier is the `printed_hip` branch — saturated, missing or
 *  out-of-range Gaia photometry all land there, so it is condition-driven
 *  rather than a magnitude cut applied from outside. */
export function resolveVMagnitude(
  photometry: GaiaPhotometry | null,
  printedV: number | null,
  cataloguedV: number | null,
): VMagnitudeResolution {
  if (photometry && isRielloTransformable(photometry)) {
    const bpMinusRp = photometry.bpMag! - photometry.rpMag!;
    return { v: photometry.gMag! - rielloGMinusV(bpMinusRp), via: 'gaia_riello' };
  }
  if (printedV !== null && Number.isFinite(printedV)) {
    return { v: printedV, via: 'printed_hip' };
  }
  if (cataloguedV !== null && Number.isFinite(cataloguedV)) {
    return { v: cataloguedV, via: 'catalogued' };
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
 *  this — see ../companions/README.md § Anchor flux conservation. */
export function vTierIsSystemBlend(via: VVia | null): boolean {
  return via === 'printed_hip' || via === 'catalogued';
}
