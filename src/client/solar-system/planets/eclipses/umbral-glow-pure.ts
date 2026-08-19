// Refracted, Rayleigh-reddened sunlight inside a caster's umbra — why a
// totally eclipsed Moon glows coppery red instead of going out.
// Derivation and the one anchored scalar: README.md § Umbral glow.

import type { PlanetAtmosphere } from '../../planet-system';

/**
 * Total deviation of a ray grazing the surface and out again, radians.
 * Standard horizontal refraction is ~34' one way, and a ray passing THROUGH
 * the atmosphere tangentially is bent at both ends.
 *
 * This is the term that puts any light in the umbra at all: it exceeds the
 * ~0.68° the Sun's limb sits below Earth's at mid-umbra, so refracted
 * sunlight reaches the whole shadow. Without refraction the umbra would be
 * black, which is what the renderer drew before this existed.
 */
export const LIMB_REFRACTION_RAD = (1.16 * Math.PI) / 180;

/**
 * Ozone Chappuis-band vertical optical depth at the renderer's 650 / 550 /
 * 450 nm channels: a 300 DU column (8.07e18 molecules/cm²) at cross-sections
 * 2.3e-21 / 3.4e-21 / 1.5e-22 cm².
 *
 * Carried here rather than in `PlanetAtmosphere` deliberately — the airlight
 * model does not carry ozone at all (`../../atmosphere/README.md` § Skylight
 * says so outright), and this is the one place its absorption leads. Amplified
 * ~70x on a limb path it removes most of the red and green while barely
 * touching blue, which is what makes the OUTER umbra read turquoise instead
 * of merely dim red.
 */
export const OZONE_CHAPPUIS_TAU: readonly [number, number, number] = [
  0.0186, 0.0274, 0.0012,
];

/** Altitudes the ozone column is spread between, km. A slab is crude against
 *  a real profile; what it has to get right is that a ray tangent below ~15 km
 *  crosses the whole column and one above ~35 km crosses none. */
export const OZONE_SLAB_KM: readonly [number, number] = [15, 35];

/** Samples across the contributing altitude band. The integrand is a smooth
 *  exponential-of-exponential; 64 puts the quadrature error far below the
 *  model error the dilution anchor already absorbs. */
const SAMPLES = 64;

/**
 * Slant column through an exponential atmosphere for a ray tangent at
 * altitude h, over the vertical column above the same point: `sqrt(2πR/H)`.
 *
 * ~70 on Earth, and it is the whole reason the umbra is red rather than
 * white: it multiplies blue's vertical depth of 0.221 up to 15.6 — which is
 * extinction by a factor of 6 million — while red's 0.049 reaches only 3.5.
 */
export function limbColumnRatio(radiusKm: number, scaleHeightKm: number): number {
  return Math.sqrt((2 * Math.PI * radiusKm) / scaleHeightKm);
}

/** Fraction of the ozone column a ray tangent at `hKm` still crosses. */
function ozoneFractionAbove(hKm: number): number {
  const [lo, hi] = OZONE_SLAB_KM;
  return Math.min(1, Math.max(0, (hi - hKm) / (hi - lo)));
}

/**
 * Per-channel transmittance of a limb path tangent at altitude `hKm`, off the
 * body's own published vertical optical depths plus ozone.
 */
export function limbTransmittance(
  atmo: PlanetAtmosphere,
  radiusKm: number,
  hKm: number,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const rayleighRatio = limbColumnRatio(radiusKm, atmo.rayleighHeightKm);
  const mieRatio = limbColumnRatio(radiusKm, atmo.mieHeightKm);
  const rayleigh = Math.exp(-hKm / atmo.rayleighHeightKm);
  const mie = Math.exp(-hKm / atmo.mieHeightKm);
  const ozone = ozoneFractionAbove(hKm);
  for (let c = 0; c < 3; c++) {
    const tau =
      atmo.rayleighCoeff[c] * rayleighRatio * rayleigh
      + atmo.mieCoeff * mieRatio * mie
      + (atmo.absorbCoeff?.[c] ?? 0) * rayleighRatio * rayleigh
      + OZONE_CHAPPUIS_TAU[c] * rayleighRatio * ozone;
    out[c] = Math.exp(-tau);
  }
  return out;
}

/**
 * The one number here that is measured rather than derived.
 *
 * Everything else is geometry and published optical depths, and the geometric
 * ring-flux argument on its own lands ~4x over the observed brightness. What
 * it omits is refractive DILUTION: bending spreads the ring's light across a
 * range of deflection angles, so the flux per unit angle falls. That integral
 * is genuinely hard and is not attempted.
 *
 * This constant stands in for it, fixed so mid-umbra lands on the measured
 * Danjon L=2 appearance — a totally eclipsed Moon near visual magnitude 0.0
 * against the full Moon's −12.74, a flux ratio of 8.0e-6.
 *
 * It is a single ACHROMATIC scalar, so it moves brightness and never hue: the
 * colour stays derived, which is the whole point of the exercise. Same shape
 * as `uPhaseScale` anchoring the reflected disc to a measured phase curve.
 */
export const UMBRA_DILUTION = 0.248;

/**
 * Angular depth of a point inside a caster's umbra, radians — positive once
 * the host's disc is entirely behind the caster's.
 *
 * Totality begins where the host's near limb passes inside the caster's,
 * which is exactly where this crosses zero.
 */
export function umbralDepthRad(
  casterAngRad: number,
  missRad: number,
  hostAngRad: number,
): number {
  return casterAngRad - missRad - hostAngRad;
}

/**
 * Per-channel fraction of the direct host irradiance reaching a point at
 * angular depth `depthRad` inside the caster's umbra.
 *
 * A ray tangent at altitude h is deflected by `ω₀·exp(−h/H)`, so a point
 * `depthRad` below the caster's limb is reached only by rays tangent at or
 * below `h_max = H·ln(ω₀/depth)`. Deeper into the shadow that band shrinks
 * toward the densest air, which is why the umbra darkens and reddens inward
 * rather than being uniform.
 *
 * The band is a ring around the caster's limb shining at the host's own
 * surface brightness times the transmittance integrated over it, so the ratio
 * of the ring's solid angle to the host's IS the flux fraction.
 *
 * **The band is capped at the atmosphere's own top**, and that cap is
 * load-bearing rather than defensive. `h_max` diverges logarithmically as the
 * depth goes to zero, and there is nothing above `heightKm` to refract, so
 * without it the umbral edge would be arbitrarily bright. It also makes the
 * term continuous through the umbral contact: the penumbra takes the full
 * ring rather than a special case, where the direct light outshines it by
 * orders of magnitude anyway. Gating on `depth > 0` instead put a step at
 * exactly the moment the direct term reached zero, which is the one instant
 * the eye is watching.
 */
export function umbralGlow(
  atmo: PlanetAtmosphere,
  casterRadiusKm: number,
  distanceKm: number,
  hostAngularRadiusRad: number,
  depthRad: number,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  if (depthRad >= LIMB_REFRACTION_RAD) return out;
  if (distanceKm <= 0 || hostAngularRadiusRad <= 0) return out;

  const uncapped =
    depthRad <= 0
      ? Infinity
      : atmo.rayleighHeightKm * Math.log(LIMB_REFRACTION_RAD / depthRad);
  const hMaxKm = Math.min(uncapped, atmo.heightKm);
  if (hMaxKm <= 0) return out;
  const step = hMaxKm / SAMPLES;
  const t: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < SAMPLES; i++) {
    limbTransmittance(atmo, casterRadiusKm, step * (i + 0.5), t);
    out[0] += t[0] * step;
    out[1] += t[1] * step;
    out[2] += t[2] * step;
  }

  // Ring solid angle over the host's. The band's angular thickness is its
  // physical thickness over the distance, which is why `distanceKm` divides
  // once more than the caster's angular radius already carries.
  const casterAngRad = casterRadiusKm / distanceKm;
  const scale =
    ((2 * Math.PI * casterAngRad)
      / (Math.PI * hostAngularRadiusRad * hostAngularRadiusRad * distanceKm))
    * UMBRA_DILUTION;
  out[0] *= scale;
  out[1] *= scale;
  out[2] *= scale;
  return out;
}
