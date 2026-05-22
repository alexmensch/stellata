// Pure colour-LUT math: Ballesteros 2012 (and its analytic inverse) plus
// LUT shape constants. Node-free so client code can import it.

// ---- LUT shape (must match src/client/star-pipeline/blackbody-lut-data.ts) ----

/** Number of RGB entries in the LUT. 256 keeps cache lines clean and is
 *  plenty of resolution for B-V over a 2.4-magnitude span. */
export const LUT_SIZE = 256;

/** Inclusive B-V range covered by the LUT. */
export const BV_MIN = -0.4;
export const BV_MAX = 2.0;

// ---- Ballesteros 2012 ---------------------------------------------------

/**
 * Ballesteros 2012 empirical relation: B-V → Teff in Kelvin.
 *
 *   Teff = 4600 × ( 1/(0.92(B-V) + 1.7) + 1/(0.92(B-V) + 0.62) )
 */
export function ballesterosTeff(bv: number): number {
  const a = 0.92 * bv + 1.7;
  const b = 0.92 * bv + 0.62;
  return 4600.0 * (1.0 / a + 1.0 / b);
}

/**
 * Analytic inverse of Ballesteros 2012: Teff (K) → B-V. Picks the
 * positive root of the quadratic that recovers `u = 0.92 · bv` from
 * `T = 4600 · (2u + 2.32) / (u² + 2.32u + 1.054)`. Discriminant
 * `4 + 1.1664·k²` is always positive (k = T/4600), so the inverse is
 * defined for all Teff > 0. Mirrored byte-for-byte in star.vert.glsl —
 * keep the two in sync.
 */
export function ballesterosBvFromTeff(teff: number): number {
  const k = teff / 4600.0;
  const disc = Math.sqrt(4.0 + 1.1664 * k * k);
  const u = (2.0 - 2.32 * k + disc) / (2.0 * k);
  return u / 0.92;
}

/** B-V value at LUT index i ∈ [0, LUT_SIZE-1]. Endpoints map to BV_MIN / BV_MAX. */
export function bvAtIndex(i: number): number {
  return BV_MIN + (i / (LUT_SIZE - 1)) * (BV_MAX - BV_MIN);
}
