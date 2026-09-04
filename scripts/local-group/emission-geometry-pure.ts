// Local Group profile geometry: the Sérsic deprojection and the
// truncated-volume integrals each family solves through, over the shared
// quadrature. docs/science-local-group.md § Local Group luminosity model.

import {
  integrateOverEllipsoid,
  integrateOverEllipsoidRz,
} from '../../src/client/hdr/emission/density0-solver-pure';

/** Ciotti & Bertin 1999 asymptotic b_n — the Sérsic shape constant
 *  placing half the projected light inside R_e. */
export function bnCoeff(n: number): number {
  return 2 * n - 1 / 3 + 4 / (405 * n);
}

/** Prugniel–Simien deprojection exponent p_n. The 3D density
 *  ν(u) = u^(−p_n)·exp(−b_n·u^(1/n)) projects to the observed 2D
 *  Sérsic law to ~1%; raymarching the 2D law as 3D density is a
 *  deprojection error (visibly too-shallow centre for n > 1). */
export function pnCoeff(n: number): number {
  return 1 - 0.6097 / n + 0.05463 / (n * n);
}

/** Deprojected Sérsic density at ellipsoidal radius u (units of R_e),
 *  for unit central normalisation. */
export function sersicNu(
  u: number,
  n: number,
  bn: number = bnCoeff(n),
  pn: number = pnCoeff(n),
): number {
  return Math.pow(u, -pn) * Math.exp(-bn * Math.pow(u, 1 / n));
}

const LANCZOS_G = 7;
const LANCZOS_COEFF = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Γ(x) for x > 0 (Lanczos approximation, ~15 significant digits). */
export function lnGamma(x: number): number {
  if (x < 0.5) {
    // Reflection keeps the approximation in its accurate half-plane.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }
  const xm = x - 1;
  let a = LANCZOS_COEFF[0];
  const t = xm + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_COEFF.length; i++) a += LANCZOS_COEFF[i] / (xm + i);
  return 0.5 * Math.log(2 * Math.PI) + (xm + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularised lower incomplete gamma P(s, x) = γ(s, x) / Γ(s).
 *  Series for x < s + 1, Lentz continued fraction otherwise. */
export function regularizedLowerGamma(s: number, x: number): number {
  if (x <= 0) return 0;
  const lg = lnGamma(s);
  if (x < s + 1) {
    let term = 1 / s;
    let sum = term;
    let k = s;
    for (let i = 0; i < 500; i++) {
      k += 1;
      term *= x / k;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return Math.min(1, sum * Math.exp(-x + s * Math.log(x) - lg));
  }
  let b = x + 1 - s;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.max(0, 1 - Math.exp(-x + s * Math.log(x) - lg) * h);
}

/** Numeric geometry integral of the unit-ρ₀ Sérsic spheroid over its
 *  proxy mesh (the u ≤ uMax ellipsoid, axes uMax·R_e). */
export function sersicGeometryIntegral(
  reffAxesPc: [number, number, number],
  n: number,
  uMax: number,
): number {
  const bn = bnCoeff(n);
  const pn = pnCoeff(n);
  return integrateOverEllipsoid(
    (r) => sersicNu(uMax * r, n, bn, pn),
    [uMax * reffAxesPc[0], uMax * reffAxesPc[1], uMax * reffAxesPc[2]],
  );
}

/** Closed form of the same integral via the lower incomplete gamma —
 *  the vitest cross-pin for the numeric path. */
export function sersicGeometryIntegralAnalytic(
  reffAxesPc: [number, number, number],
  n: number,
  uMax: number,
): number {
  const bn = bnCoeff(n);
  const pn = pnCoeff(n);
  const alpha = n * (3 - pn);
  const gammaLower =
    regularizedLowerGamma(alpha, bn * Math.pow(uMax, 1 / n)) *
    Math.exp(lnGamma(alpha));
  return (
    4 * Math.PI * reffAxesPc[0] * reffAxesPc[1] * reffAxesPc[2] * n * gammaLower /
    Math.pow(bn, alpha)
  );
}

/** Ellipsoidal radius (units of R_e) enclosing 99% of the profile's
 *  total light — the spheroid mesh-envelope rule. Solved on the
 *  analytic radial reduction of the same profile. */
export function u99(n: number): number {
  const bn = bnCoeff(n);
  const alpha = n * (3 - pnCoeff(n));
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (regularizedLowerGamma(alpha, mid) < 0.99) lo = mid;
    else hi = mid;
  }
  return Math.pow(0.5 * (lo + hi) / bn, n);
}

/** Numeric geometry integral of the unit-ρ₀ exponential disc
 *  ρ(R, z) = exp(−R/R_d)·exp(−|z|/z_d) over its ellipsoidal proxy
 *  (semi-axes rEnv, rEnv, zEnv). No closed form once truncated; the
 *  untruncated limit 4π·R_d²·z_d is the test cross-pin. */
export function discGeometryIntegral(
  rdPc: number,
  zdPc: number,
  rEnvPc: number,
  zEnvPc: number,
): number {
  return integrateOverEllipsoidRz(
    (R, z) => Math.exp(-R / rdPc - z / zdPc),
    rEnvPc,
    zEnvPc,
  );
}
