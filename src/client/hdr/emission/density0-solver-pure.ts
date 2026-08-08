// Turning a published total magnitude into a volumetric emitter's ρ₀:
// the flux number, Gauss–Legendre quadrature over a truncated ellipsoid,
// and the far-field solve. See README.md § Solving ρ₀.

/** Zero-point-free flux number for an apparent magnitude. */
export function fluxNumber(mV: number): number {
  return Math.pow(10, -0.4 * mV);
}

/** The distance an ABSOLUTE magnitude is defined at, which is what an
 *  emitter anchored on a published M rather than an observed m passes as
 *  `solveDensity0`'s first argument. */
export const ABSOLUTE_MAGNITUDE_DISTANCE_PC = 10;

/** Gauss–Legendre nodes/weights on [-1, 1] (Newton on the Legendre
 *  recurrence). */
function gaussLegendre(n: number): { x: Float64Array; w: Float64Array } {
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

const QUAD_RADIAL_NODES = 96;
const QUAD_POLAR_NODES = 48;

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

/** The single numeric quadrature path every profile solves through:
 *  ∫ f dV over the axis-aligned ellipsoid with semi-axes (A, B, C), where
 *  f is given in unit-ball coordinates as f(r, cosθ) with cosθ measured
 *  from the +z (C) axis.
 *
 *  f must be axisymmetric about local z and symmetric under z → −z in the
 *  unit-ball frame — true for every profile solved here (Sérsic density
 *  depends only on r when the mesh axes are proportional to the R_e
 *  ellipsoid; disc and bulge densities depend on (R, |z|)). */
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

/** `integrateOverEllipsoid` for a profile stated in cylindrical (R, |z|) —
 *  the disc and bulge families, whose envelopes are spheroids of
 *  revolution. Taking the two semi-axes as scalars rather than a triple is
 *  what makes both the axis swap and an unequal R-plane inexpressible: the
 *  unit-ball mapping lives here instead of in each caller's closure. */
export function integrateOverEllipsoidRz(
  f: (rPc: number, absZPc: number) => number,
  radiusPc: number,
  halfThicknessPc: number,
): number {
  return integrateOverEllipsoid(
    (r, cosTheta) =>
      f(radiusPc * r * Math.sqrt(1 - cosTheta * cosTheta), halfThicknessPc * r * cosTheta),
    [radiusPc, radiusPc, halfThicknessPc],
  );
}

/** ρ₀ such that far-field flux at the catalog distance reproduces the
 *  component's flux share: ρ₀ = d₀²·F / G. Truncation compensation is
 *  inherent — G is the integral over the ACTUAL mesh volume, so whatever
 *  the envelope clips, ρ₀ makes up. */
export function solveDensity0(
  distancePc: number,
  fluxShare: number,
  geometryIntegral: number,
): number {
  return (distancePc * distancePc * fluxShare) / geometryIntegral;
}
