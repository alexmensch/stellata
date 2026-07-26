// Non-singular equinoctial elements, the representation every planet element
// source is expressed in before a position is solved. See README.md
// § Equinoctial elements.

const DEG = Math.PI / 180;

/** Equinoctial elements: `h/k` carry eccentricity and perihelion together,
 *  `p/q` carry inclination and node together, so neither pair goes singular
 *  as `e → 0` or `i → 0`. */
export interface EquinoctialElements {
  /** Semi-major axis, AU. */
  aAu: number;
  /** e·sin ϖ, where ϖ = Ω + ω is the longitude of perihelion. */
  h: number;
  /** e·cos ϖ. */
  k: number;
  /** tan(i/2)·sin Ω. */
  p: number;
  /** tan(i/2)·cos Ω. */
  q: number;
  /** Mean longitude λ = M + ϖ, degrees, continuous rather than folded into
   *  [0, 360) so a linear interpolation between two values never crosses a
   *  branch cut. */
  lambdaDeg: number;
}

/** Classical elements in the form `orbitalStateToCartesian` consumes. */
export interface ClassicalElements {
  aAu: number;
  e: number;
  incRad: number;
  nodeRad: number;
  argPeriRad: number;
  mRad: number;
}

export function makeEquinoctial(): EquinoctialElements {
  return { aAu: 0, h: 0, k: 0, p: 0, q: 0, lambdaDeg: 0 };
}

export function makeClassical(): ClassicalElements {
  return { aAu: 0, e: 0, incRad: 0, nodeRad: 0, argPeriRad: 0, mRad: 0 };
}

/** Build equinoctial elements from the angle set both element sources
 *  publish: JPL's tables give ϖ and the mean longitude λ directly, and a
 *  Horizons ELEMENTS row gives Ω, ω and M to add into them. */
export function equinoctialFromAngles(
  aAu: number,
  e: number,
  iDeg: number,
  longnodeDeg: number,
  longperiDeg: number,
  lambdaDeg: number,
  out: EquinoctialElements,
): void {
  const longperi = longperiDeg * DEG;
  const node = longnodeDeg * DEG;
  const tanHalfI = Math.tan((iDeg * DEG) / 2);
  out.aAu = aAu;
  out.h = e * Math.sin(longperi);
  out.k = e * Math.cos(longperi);
  out.p = tanHalfI * Math.sin(node);
  out.q = tanHalfI * Math.cos(node);
  out.lambdaDeg = lambdaDeg;
}

/**
 * Recover the classical set. The node and argument of perihelion come back
 * in the canonical `i ≥ 0` convention, which for a near-coplanar orbit is
 * not the pair the source table printed: a negative tabulated inclination
 * reappears as `(|i|, Ω ± 180°, ω ± 180°)`. That is the same rotation —
 * `Rz(π)·Rx(i)·Rz(π) = Rx(−i)` — so positions and rings are unaffected;
 * only a test reading Ω or ω back sees the difference.
 */
export function equinoctialToClassical(
  eq: EquinoctialElements,
  out: ClassicalElements,
): void {
  const longperi = Math.atan2(eq.h, eq.k);
  const node = Math.atan2(eq.p, eq.q);
  out.aAu = eq.aAu;
  out.e = Math.hypot(eq.h, eq.k);
  out.incRad = 2 * Math.atan(Math.hypot(eq.p, eq.q));
  out.nodeRad = node;
  out.argPeriRad = longperi - node;
  out.mRad = eq.lambdaDeg * DEG - longperi;
}

/**
 * Linear blend from `a` (weight `1 − w`) toward `b` (weight `w`), written
 * into `out`, which may alias either input.
 *
 * λ is blended along the **shortest arc**: the two sources count revolutions
 * from different origins, so their raw λ differ by whole turns even when they
 * agree on where the planet is.
 */
export function blendEquinoctialInto(
  a: EquinoctialElements,
  b: EquinoctialElements,
  w: number,
  out: EquinoctialElements,
): void {
  const dLambda = b.lambdaDeg - a.lambdaDeg;
  const shortest = dLambda - 360 * Math.round(dLambda / 360);
  out.aAu = a.aAu + (b.aAu - a.aAu) * w;
  out.h = a.h + (b.h - a.h) * w;
  out.k = a.k + (b.k - a.k) * w;
  out.p = a.p + (b.p - a.p) * w;
  out.q = a.q + (b.q - a.q) * w;
  out.lambdaDeg = a.lambdaDeg + shortest * w;
}
