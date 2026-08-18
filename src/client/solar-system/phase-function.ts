// Per-planet phase functions φ(α) for reflected-light apparent magnitude
// — Lambertian default + Mallama 2018 polynomials where published. See
// docs/science-solar-system.md § Planet phase functions.

/** Mallama 2018 ΔV(α°) = c0 + c1·α + … + c7·α⁷. c0 = 0 for every
 *  planet except Saturn, which absorbs a static ring-tilt brightness
 *  boost via c0 < 0. c7 = 0 for every planet except Mercury — the
 *  only published fit beyond degree 6. */
export interface PhaseCoefficients {
  readonly c0: number;
  readonly c1: number;
  readonly c2: number;
  readonly c3: number;
  readonly c4: number;
  readonly c5: number;
  readonly c6: number;
  readonly c7: number;
  /** Upper validity bound in degrees. Beyond this α, callers fall
   *  back to anchor-scaled Lambert. Sentinel `0` disables the
   *  polynomial entirely (pure Lambert). */
  readonly alphaMaxDeg: number;
}

const LOG10 = Math.log(10);
const RAD_TO_DEG = 180 / Math.PI;

/** Lambertian (perfectly diffuse sphere) phase factor — the default
 *  fallback when no empirical curve is published for a body. Clamps α
 *  to [0, π] defensively. */
export function lambertianPhaseFactor(alphaRad: number): number {
  const a = Math.max(0, Math.min(Math.PI, alphaRad));
  return (Math.sin(a) + (Math.PI - a) * Math.cos(a)) / Math.PI;
}

/** Horner-evaluated Mallama 2018 ΔV polynomial in α-degrees. Helper
 *  exists so the in-validity-bound and at-boundary-anchor paths share
 *  one definition. */
function mallamaDV(coefs: PhaseCoefficients, aDeg: number): number {
  return (
    coefs.c0 +
    aDeg *
      (coefs.c1 +
        aDeg *
          (coefs.c2 +
            aDeg *
              (coefs.c3 +
                aDeg *
                  (coefs.c4 +
                    aDeg * (coefs.c5 + aDeg * (coefs.c6 + aDeg * coefs.c7))))))
  );
}

/** Mallama 2018 empirical phase factor. Inside [0, αmax°] uses the
 *  polynomial; beyond αmax falls back to anchor-scaled Lambert
 *  (continuous at the boundary). α clamped to [0, π] — Horner
 *  diverges wildly past its fitted domain, so the αmax fallback is
 *  load-bearing against accidental degrees/radians swaps. */
export function mallamaPhaseFactor(
  coefs: PhaseCoefficients,
  alphaRad: number,
): number {
  if (coefs.alphaMaxDeg <= 0) return lambertianPhaseFactor(alphaRad);
  const a = Math.max(0, Math.min(Math.PI, alphaRad));
  const aDeg = a * RAD_TO_DEG;
  if (aDeg <= coefs.alphaMaxDeg) {
    return Math.exp(-mallamaDV(coefs, aDeg) * 0.4 * LOG10);
  }
  // Past αmax: anchor-scaled Lambert. k folds the empirical-vs-Lambert
  // ratio at the boundary into a single multiplier.
  const boundaryFlux = Math.exp(-mallamaDV(coefs, coefs.alphaMaxDeg) * 0.4 * LOG10);
  const boundaryLambert = lambertianPhaseFactor(coefs.alphaMaxDeg / RAD_TO_DEG);
  return lambertianPhaseFactor(a) * (boundaryFlux / boundaryLambert);
}

/** Phase-factor flux multiplier at α = 0 — i.e. `10^(−c0/2.5)`. Drives
 *  the per-host visibility cull (see `cullDistancePc` in
 *  `planet-body-field.ts`): for almost every planet this is 1, but
 *  Saturn's ring term raises it materially and the cull distance has
 *  to widen to match.
 *
 *  The α=0 framing is deliberate, not a proxy for the polynomial's
 *  maximum: for Venus the true polynomial peak sits ~3° above zero,
 *  ~0.1% above φ(0). The cull stays a conservative outer bound — at
 *  any α the actual flux is ≤ this value plus that sub-millimagnitude
 *  Venus margin — so the α=0 reading is what the cache wants. */
export function alphaZeroPhaseFactor(coefs: PhaseCoefficients | undefined): number {
  if (!coefs || coefs.alphaMaxDeg <= 0) return 1;
  return Math.exp(-coefs.c0 * 0.4 * LOG10);
}

/**
 * Phase angle α = ∠(viewer–planet–host) from displacement vectors.
 * `(dvx, dvy, dvz)` is the viewer → planet displacement and
 * `(dhx, dhy, dhz)` the viewer → host displacement (any consistent
 * frame); the planet → host leg is the difference. Returns 0 if either
 * leg has zero length (degenerate viewer/host/planet coincidence).
 */
export function phaseAngleFor(
  dvx: number,
  dvy: number,
  dvz: number,
  dhx: number,
  dhy: number,
  dhz: number,
): number {
  // vphHat = planet → viewer (= −view-space planet direction).
  // hphHat = planet → host. Both normalised; cos α is the dot product.
  const lenV = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
  const lenHp = Math.sqrt(
    (dhx - dvx) ** 2 + (dhy - dvy) ** 2 + (dhz - dvz) ** 2,
  );
  if (lenV <= 0 || lenHp <= 0) return 0;
  const vphX = -dvx / lenV;
  const vphY = -dvy / lenV;
  const vphZ = -dvz / lenV;
  const hphX = (dhx - dvx) / lenHp;
  const hphY = (dhy - dvy) / lenHp;
  const hphZ = (dhz - dvz) / lenHp;
  const cosA = Math.max(-1, Math.min(1, vphX * hphX + vphY * hphY + vphZ * hphZ));
  return Math.acos(cosA);
}

/**
 * Phase factor φ(α) given viewer→planet and viewer→host displacement
 * vectors. Computes α via `phaseAngleFor` and dispatches into Mallama
 * (when a polynomial exists) or Lambertian (the default fallback for
 * Pluto + every exoplanet). Mirrors the
 * `if (alphaMaxDeg > 0.0 && alphaDeg <= alphaMaxDeg)` branch in
 * `planet.vert.glsl` exactly through the shared helpers above.
 * Degenerate zero-length legs land at α = 0 ⇒ φ = 1.
 */
export function phaseFactorFor(
  dvx: number,
  dvy: number,
  dvz: number,
  dhx: number,
  dhy: number,
  dhz: number,
  coefs: PhaseCoefficients | undefined,
): number {
  const alpha = phaseAngleFor(dvx, dvy, dvz, dhx, dhy, dhz);
  return coefs ? mallamaPhaseFactor(coefs, alpha) : lambertianPhaseFactor(alpha);
}

/** Illuminated fraction of a sphere seen at phase angle α: (1 + cos α)/2
 *  — 1 at full phase (α = 0), 0 at new (α = 180). Gates the resolved-
 *  regime reflected glare so a crescent body's dark limb emits ~none;
 *  mirrored in planet.vert.glsl as (1 + cosA)·0.5. α clamped to [0, π]. */
export function illuminatedFraction(alphaRad: number): number {
  const a = Math.max(0, Math.min(Math.PI, alphaRad));
  return (1 + Math.cos(a)) / 2;
}

/** Clamp bounds for `phaseRatioToLambert` — the thin-crescent regime is
 *  where big ratios occur and it is cos-weighted dim, so the bound
 *  limits LDR clipping without visibly flattening the curve. */
export const PHASE_RATIO_MIN = 0.25;
export const PHASE_RATIO_MAX = 4;

/**
 * φ_body(α) / φ_Lambert(α), clamped to [PHASE_RATIO_MIN, PHASE_RATIO_MAX]
 * — the mesh-LOD lighting scalar that corrects the mesh's Lambert
 * disc-integrated output to the measured phase curve. A pure function of
 * phase angle (= 1 at α = 0 by construction, no distance term — an
 * appMag match would blow out on approach). Bodies without coefficients
 * return exactly 1. Past αmax both curves are anchor-scaled Lambert, so
 * the ratio is evaluated at min(α, αmax) — also what keeps the
 * denominator away from Lambert's α → π zero.
 */
export function phaseRatioToLambert(
  coefs: PhaseCoefficients | undefined,
  alphaRad: number,
): number {
  if (!coefs || coefs.alphaMaxDeg <= 0) return 1;
  const a = Math.max(0, Math.min(Math.PI, alphaRad));
  const aCap = Math.min(a, coefs.alphaMaxDeg / RAD_TO_DEG);
  const ratio = mallamaPhaseFactor(coefs, aCap) / lambertianPhaseFactor(aCap);
  return Math.min(PHASE_RATIO_MAX, Math.max(PHASE_RATIO_MIN, ratio));
}

// Per-planet coefficients from Mallama 2018 (Icarus 282). Each
// alphaMaxDeg is the upper bound observed in the cited data; outside
// that range the renderer falls back to anchor-scaled Lambert.

/** Mercury — Mallama 2018 Table A-1.2 full 7th-order fit, valid to
 *  the paper's 170° bound. c7 rides the third per-instance vec4
 *  (`iPhaseCoefsC`); the degree-6 storage era capped alphaMaxDeg at
 *  87° because the dropped c7·α⁷ term diverged past that. */
export const MERCURY_PHASE: PhaseCoefficients = {
  c0: 0,
  c1: 6.617e-2,
  c2: -1.867e-3,
  c3: 4.103e-5,
  c4: -4.583e-7,
  c5: 2.643e-9,
  c6: -7.012e-12,
  c7: 6.592e-15,
  alphaMaxDeg: 170,
};

/** Venus — Mallama 2018 Table A-2.2 4th-order fit, valid to 165°.
 *  The α = 170° forward-scattering peak isn't captured by the
 *  polynomial — Lambert takes over there. */
export const VENUS_PHASE: PhaseCoefficients = {
  c0: 0,
  c1: -1.044e-3,
  c2: 3.687e-4,
  c3: -2.814e-6,
  c4: 8.938e-9,
  c5: 0,
  c6: 0,
  c7: 0,
  alphaMaxDeg: 165,
};

/** Earth — closed-form cubic fit through the four discrete values
 *  in Mallama 2018 Table A-3.1 (the paper publishes a table, not a
 *  polynomial). alphaMaxDeg = 135°, the table's last datum. */
export const EARTH_PHASE: PhaseCoefficients = {
  c0: 0,
  c1: 3.406e-2,
  c2: -2.817e-4,
  c3: 1.762e-6,
  c4: 0,
  c5: 0,
  c6: 0,
  c7: 0,
  alphaMaxDeg: 135,
};

/** Mars — Mallama 2018 Table A-4.2 2nd-order fit, valid to ~50°.
 *  The published rotation + orbital-longitude phase terms (L₁, L₂)
 *  aren't modelled. */
export const MARS_PHASE: PhaseCoefficients = {
  c0: 0,
  c1: 2.267e-2,
  c2: -1.302e-4,
  c3: 0,
  c4: 0,
  c5: 0,
  c6: 0,
  c7: 0,
  alphaMaxDeg: 50,
};

/** Jupiter — Mallama 2018 Table A-5.2 2nd-order fit, observed range
 *  α = 0–12°. */
export const JUPITER_PHASE: PhaseCoefficients = {
  c0: 0,
  c1: -3.7e-4,
  c2: 6.16e-4,
  c3: 0,
  c4: 0,
  c5: 0,
  c6: 0,
  c7: 0,
  alphaMaxDeg: 12,
};

/** Saturn — static-β = 16° (long-run mean) approximation of the
 *  Mallama 2018 Table A-6.2 joint α/ring-tilt formula. c0 absorbs
 *  the ring contribution + opposition-surge exp-term-at-α=0 bias;
 *  c1 carries the linear α modulation. */
export const SATURN_PHASE: PhaseCoefficients = {
  c0: -0.55,
  c1: 0.026,
  c2: 0,
  c3: 0,
  c4: 0,
  c5: 0,
  c6: 0,
  c7: 0,
  alphaMaxDeg: 6.5,
};

// Uranus and Neptune fall through to Lambert by design — Mallama
// 2018 Tables A-7.2 / A-8.2 model sub-latitude (Uranus) and temporal
// (Neptune) effects, not α, because Earth-bound max α is negligible
// for both. Pluto and every exoplanet share the Lambert fallback.

/** Earth's Moon — the classic lunar phase law, not Mallama (the paper
 *  covers planets only). Allen's Astrophysical Quantities gives
 *  m = −12.73 + 1.49·|φ| + 0.043·φ⁴ for φ in radians; converting to
 *  degrees puts 1.49·(π/180) in c1 and 0.043·(π/180)⁴ in c4, which is
 *  the ΔV(α°) = 0.026·α + 4e-9·α⁴ this row encodes. It reproduces the
 *  measured full-to-quarter ratio of ~11× (10.99× here).
 *
 *  αmax = 150° is the law's fitted range; the α⁴ term is an
 *  extrapolation beyond it and Lambert takes over. The opposition
 *  surge inside ~5° is sharper than the linear term, which averages
 *  over it — the α = 0 anchor is still exact, so the −12.74 full-Moon
 *  calibration is untouched.
 *
 *  Every other moon keeps the Lambert fallback: see
 *  docs/science-solar-system.md § Moons for why. */
export const MOON_PHASE: PhaseCoefficients = {
  c0: 0,
  c1: 2.6e-2,
  c2: 0,
  c3: 0,
  c4: 4e-9,
  c5: 0,
  c6: 0,
  c7: 0,
  alphaMaxDeg: 150,
};
