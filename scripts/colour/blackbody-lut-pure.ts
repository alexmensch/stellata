// Pure colour-LUT math shared by the generator (`blackbody-lut.ts`), the
// runtime DataTexture wrapper (`src/client/shaders/blackbody-lut.ts`),
// the GLSL shader (mirrored), and the star-colour routing helper
// (`src/client/shaders/star-color-routing-pure.ts`). No node:* imports —
// safe to import from the browser bundle.

// ---- LUT shape (must match src/client/shaders/blackbody-lut-data.ts) ----

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

// ---- Teff → LUT t -------------------------------------------------------

/** Effective Teff at the LUT's hot end (B-V = BV_MIN). Stars with Apsis
 *  Teff above this clamp to the hottest LUT entry — physically blue-white
 *  is the right asymptote for O/early-B / hot DA white dwarfs. */
export const TEFF_AT_BV_MIN = ballesterosTeff(BV_MIN);

/** Effective Teff at the LUT's cool end (B-V = BV_MAX). Apsis Teff
 *  below this clamps to the coolest LUT entry. */
export const TEFF_AT_BV_MAX = ballesterosTeff(BV_MAX);

/**
 * Convert a Teff (K) to a normalised LUT t coordinate in [0, 1] suitable
 * for `texture(uColorLut, vec2(t, 0.5))`. Walks back through Ballesteros
 * 2012's inverse to land in the LUT's B-V parameter space, then
 * normalises against [BV_MIN, BV_MAX]. Out-of-range Teff clamps to the
 * nearer endpoint.
 */
export function teffToLutT(teff: number): number {
  const bv = ballesterosBvFromTeff(teff);
  const t = (bv - BV_MIN) / (BV_MAX - BV_MIN);
  return Math.min(1.0, Math.max(0.0, t));
}
