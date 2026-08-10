// The Gaia DR3 broadband bundle and the validity gate every published
// relation over it shares. See README.md § The published relations.

/** The three Gaia DR3 broadband magnitudes a published relation reads.
 *  Structurally satisfied by `GaiaAstrometryCatalogRow`. */
export interface GaiaPhotometry {
  gMag: number | null;
  bpMag: number | null;
  rpMag: number | null;
}

/** Gaia's CCD response saturates on the brightest sources, so `phot_g_mean_mag`
 *  below this bound is systematically unreliable and the printed tier takes
 *  over regardless of colour. Calibrated against the printed-vs-transformed
 *  |ΔV| distribution — see README.md § Where the validity bound comes from. */
export const GAIA_PHOTOMETRY_SATURATION_G = 4.0;

/** G and BP−RP as plain numbers, for a row whose photometry sits in the regime
 *  the published relations were calibrated on — every band present and finite,
 *  and G above the saturation bound. Null otherwise; each relation applies its
 *  own colour range on top.
 *
 *  Returns the values rather than a boolean so the algebra downstream reads the
 *  very numbers the gate accepted: a predicate would leave every caller
 *  re-deriving them behind non-null assertions, where a later edit to either
 *  half silently stops matching the other. */
export function calibratedPhotometry(
  photometry: GaiaPhotometry | null,
): { gMag: number; bpMinusRp: number } | null {
  if (!photometry) return null;
  const { gMag, bpMag, rpMag } = photometry;
  if (gMag === null || bpMag === null || rpMag === null) return null;
  if (!Number.isFinite(gMag) || !Number.isFinite(bpMag) || !Number.isFinite(rpMag)) {
    return null;
  }
  if (gMag < GAIA_PHOTOMETRY_SATURATION_G) return null;
  return { gMag, bpMinusRp: bpMag - rpMag };
}

/** Evaluate a coefficient list in ascending powers of `x` (Horner). */
export function polynomial(coeffs: readonly number[], x: number): number {
  let acc = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) acc = acc * x + coeffs[i];
  return acc;
}
