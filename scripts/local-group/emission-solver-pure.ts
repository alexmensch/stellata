// DENSITY0 solver for Local Group emission: numeric geometry integrals
// over each object's truncated proxy-mesh volume, plus the analytic
// Sérsic closed forms the tests cross-pin. docs/science-local-group.md § LG luminosity.

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

/** Zero-point-free flux number for an apparent magnitude. */
export function fluxNumber(mV: number): number {
  return Math.pow(10, -0.4 * mV);
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

/** Gauss–Legendre nodes/weights on [-1, 1] (Newton on the Legendre
 *  recurrence). */
export function gaussLegendre(n: number): { x: Float64Array; w: Float64Array } {
  const x = new Float64Array(n);
  const w = new Float64Array(n);
  const m = (n + 1) >> 1;
  for (let i = 0; i < m; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let z1 = Infinity;
    let pp = 0;
    while (Math.abs(z - z1) > 1e-15) {
      let p0 = 1;
      let p1 = 0;
      for (let j = 0; j < n; j++) {
        const p2 = p1;
        p1 = p0;
        p0 = ((2 * j + 1) * z * p1 - j * p2) / (j + 1);
      }
      pp = (n * (z * p0 - p1)) / (z * z - 1);
      z1 = z;
      z = z1 - p0 / pp;
    }
    x[i] = -z;
    x[n - 1 - i] = z;
    w[i] = 2 / ((1 - z * z) * pp * pp);
    w[n - 1 - i] = w[i];
  }
  return { x, w };
}

export const QUAD_RADIAL_NODES = 96;
export const QUAD_POLAR_NODES = 48;

function mapToUnit(gl: { x: Float64Array; w: Float64Array }): {
  x: Float64Array;
  w: Float64Array;
} {
  const n = gl.x.length;
  const x = new Float64Array(n);
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = 0.5 * (gl.x[i] + 1);
    w[i] = 0.5 * gl.w[i];
  }
  return { x, w };
}

const GL_R = mapToUnit(gaussLegendre(QUAD_RADIAL_NODES));
const GL_C = mapToUnit(gaussLegendre(QUAD_POLAR_NODES));

/** The single numeric quadrature path both profile families solve
 *  through: ∫ f dV over the axis-aligned ellipsoid with semi-axes
 *  (A, B, C), where f is given in unit-ball coordinates as
 *  f(r, cosθ) with cosθ measured from the +z (C) axis.
 *
 *  f must be axisymmetric about local z and symmetric under z → −z in
 *  the unit-ball frame — true for every profile solved here (Sérsic
 *  density depends only on r when the mesh axes are proportional to
 *  the R_e ellipsoid; disc and bulge densities depend on (R, |z|)). */
export function integrateOverEllipsoid(
  f: (rUnit: number, cosTheta: number) => number,
  axes: [number, number, number],
): number {
  let sum = 0;
  for (let i = 0; i < QUAD_RADIAL_NODES; i++) {
    const r = GL_R.x[i];
    const r2w = r * r * GL_R.w[i];
    let inner = 0;
    for (let j = 0; j < QUAD_POLAR_NODES; j++) {
      inner += GL_C.w[j] * f(r, GL_C.x[j]);
    }
    sum += r2w * inner;
  }
  // 2π from azimuthal symmetry, ×2 from the z-reflection half-domain.
  return axes[0] * axes[1] * axes[2] * 4 * Math.PI * sum;
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
  return integrateOverEllipsoid((r, c) => {
    const R = rEnvPc * r * Math.sqrt(1 - c * c);
    const z = zEnvPc * r * c;
    return Math.exp(-R / rdPc - z / zdPc);
  }, [rEnvPc, rEnvPc, zEnvPc]);
}

/** ρ₀ such that far-field flux at the catalog distance reproduces the
 *  component's flux share: ρ₀ = d₀²·F / G. Truncation compensation is
 *  inherent — G is the integral over the ACTUAL mesh volume, so
 *  whatever the envelope clips, ρ₀ makes up. */
export function solveDensity0(
  distancePc: number,
  fluxShare: number,
  geometryIntegral: number,
): number {
  return (distancePc * distancePc * fluxShare) / geometryIntegral;
}
