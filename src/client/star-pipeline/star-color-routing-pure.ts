// Shader-side Apsis-Teff bridge (`bestApsisTeff`) for the two-tier
// star-colour LUT input. See src/client/star-pipeline/README.md
// extinction/README.md.

/** Sentinel float written to the per-instance Apsis Teff attribute when
 *  no Apsis Teff is available. 0.0 is unambiguous — Apsis Teff is always
 *  positive when present, so the shader can gate with `iTeffApsis > 0.0`. */
export const NO_APSIS_TEFF = 0;

/** Best Apsis Teff for the shader-side per-instance attribute. Picks
 *  gspphot over gspspec when both are present; returns NO_APSIS_TEFF
 *  when neither is available. Bridges the v6 catalog fields to the
 *  single-float `iTeffApsis` attribute the vertex shader reads. */
export function bestApsisTeff(
  teffGspphot: number,
  teffGspspec: number,
): number {
  // `x > 0` rejects NaN, zero, and negatives in one predicate. The only
  // additional case Number.isFinite would catch is +Infinity, which the
  // Apsis ingest doesn't produce.
  if (teffGspphot > 0) return teffGspphot;
  if (teffGspspec > 0) return teffGspspec;
  return NO_APSIS_TEFF;
}
