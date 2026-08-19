// Ring-system contribution to a ringed body's unresolved apparent
// magnitude: Mallama & Hilton's joint phase-angle / ring-tilt law.
// See README.md § Ring photometry.

import {
  lambertianPhaseFactor,
  phaseDV,
  type PhaseCoefficients,
} from '../../phase-function';

/**
 * Coefficients of the joint α / ring-tilt magnitude law for a ring
 * system, in the form
 *
 *   ΔV(α, β) = tiltMag·sin β + alphaSlope·α
 *            + surgeMag·sin β·exp(surgeDecayPerDeg·α)
 *
 * for the globe **and** rings together, against `globeZeroPointDelta` —
 * the offset between the law's own V₁(0) and the globe-alone V₁(0) the
 * body's `phaseCoefficients` are anchored to. α and β in degrees.
 */
export interface RingSystemPhotometry {
  readonly tiltMag: number;
  readonly alphaSlope: number;
  readonly surgeMag: number;
  readonly surgeDecayPerDeg: number;
  readonly globeZeroPointDelta: number;
  /** Upper α bound of the published joint fit, degrees. */
  readonly alphaMaxDeg: number;
  /** Upper β bound of the published joint fit, degrees. */
  readonly betaMaxDeg: number;
}

/**
 * Saturn — Mallama & Hilton 2018 Eq. 10 (Mallama 2012), the whole
 * system at V₁(0) = −8.914 against the globe-alone −8.95 of Eq. 11.
 * Fitted over α < 6.5°, β < 27°.
 */
export const SATURN_RING_PHOTOMETRY: RingSystemPhotometry = {
  tiltMag: -1.825,
  alphaSlope: 0.026,
  surgeMag: -0.378,
  surgeDecayPerDeg: -2.25,
  globeZeroPointDelta: 0.036,
  alphaMaxDeg: 6.5,
  betaMaxDeg: 27,
};

/**
 * Fraction of the reflected ring flux that reaches a viewer on the
 * opposite side of the ring plane from the host. Mallama's own answer
 * is β = 0 — no ring term at all — because from Earth the geometry is
 * rare and faint; stellata's camera reaches it routinely, so the term
 * survives at the transmitted fraction `planet-rings.frag.glsl` already
 * commits the resolved annulus to (`TRANSMIT`), which is what keeps the
 * point-source and resolved models agreeing on which side is lit.
 * `ring-photometry-pure.test.ts` pins the two together.
 */
export const RING_BACKLIT_TRANSMIT = 0.35;

const DEG = Math.PI / 180;
const LOG10 = Math.log(10);

/**
 * Ring-plane elevation of a direction, in degrees, signed north-positive
 * about the ring pole: the planetocentric latitude Mallama's β is built
 * from. `dir` is a body → target displacement (any consistent frame with
 * `pole`), `pole` the body's ring-plane normal. Returns 0 for a
 * degenerate zero-length leg.
 */
export function ringPlaneElevationDeg(
  dx: number,
  dy: number,
  dz: number,
  px: number,
  py: number,
  pz: number,
): number {
  const dLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const pLen = Math.sqrt(px * px + py * py + pz * pz);
  if (dLen <= 0 || pLen <= 0) return 0;
  const sinB = (dx * px + dy * py + dz * pz) / (dLen * pLen);
  return Math.asin(Math.max(-1, Math.min(1, sinB))) / DEG;
}

/**
 * Mallama's effective ring inclination β from the viewer's and the
 * host's planetocentric latitudes: the geometric mean √(β_v·β_h) when
 * both sit on the same side of the ring plane. Contrary signs are the
 * backlit case, which the published law zeroes; the sign is returned
 * separately so the caller can apply `RING_BACKLIT_TRANSMIT` instead.
 * Clamped to the fit's `betaMaxDeg` — a camera over Saturn's pole
 * reaches β ≈ 49°, well past the 27° an Earth-bound fit ever saw, and
 * holding the term at its bound is a stated clamp rather than a silent
 * extrapolation.
 */
export function effectiveRingTiltDeg(
  photometry: RingSystemPhotometry,
  viewerElevationDeg: number,
  hostElevationDeg: number,
): { betaDeg: number; backlit: boolean } {
  const bv = Math.abs(viewerElevationDeg);
  const bh = Math.abs(hostElevationDeg);
  const betaDeg = Math.min(photometry.betaMaxDeg, Math.sqrt(bv * bh));
  const backlit = viewerElevationDeg * hostElevationDeg < 0;
  return { betaDeg, backlit };
}

/**
 * Ring flux as a fraction of the globe's own flux at the same α, from
 * the joint law minus the globe-alone curve `globe` carries. Past
 * the joint fit's `alphaMaxDeg` the ring term is anchor-scaled Lambert
 * — the same convention `empiricalPhaseFactor` uses past a globe
 * polynomial's bound — because the law's α slope is the ring opposition
 * surge, spent by ~2°, and the paper states outright that there is not
 * enough information to extend the system magnitude beyond 6.5°.
 *
 * Floored at zero: `globeZeroPointDelta` separates two independently
 * determined zero points (2012 photometry against 2017 synthetic
 * spectrophotometry), and below β ≈ 0.94° it swamps the tilt term and
 * would make a near-edge-on system marginally fainter than its own bare
 * globe. 0.036 mag is inside the mutual uncertainty of the two
 * determinations, so it is a calibration offset to floor, not an
 * edge-on ring occultation to model.
 */
export function ringFluxRatio(
  photometry: RingSystemPhotometry,
  alphaDeg: number,
  betaDeg: number,
  backlit: boolean,
  globe: PhaseCoefficients,
): number {
  const aCap = Math.min(Math.max(0, alphaDeg), photometry.alphaMaxDeg);
  const sinB = Math.sin(betaDeg * DEG);
  const dvSystem =
    photometry.tiltMag * sinB +
    photometry.alphaSlope * aCap +
    photometry.surgeMag * sinB * Math.exp(photometry.surgeDecayPerDeg * aCap);
  const totalOverGlobe = Math.exp(
    -(photometry.globeZeroPointDelta + dvSystem - phaseDV(globe, aCap)) * 0.4 * LOG10,
  );
  let ratio = Math.max(0, totalOverGlobe - 1);
  if (alphaDeg > photometry.alphaMaxDeg) {
    ratio *=
      lambertianPhaseFactor(Math.min(alphaDeg, 180) * DEG) /
      lambertianPhaseFactor(photometry.alphaMaxDeg * DEG);
  }
  return backlit ? ratio * RING_BACKLIT_TRANSMIT : ratio;
}

/**
 * Multiplier on the globe's phase factor φ(α) that carries the whole
 * system's flux — the one number the apparent-magnitude formula and its
 * GPU attribute consume. The law is defined as a difference against a
 * globe curve, so a body carrying ring photometry without
 * `phaseCoefficients` gets no ring term at all; `planet-system.test.ts`
 * pins the pairing so that combination cannot ship.
 */
export function ringSystemFluxFactor(
  photometry: RingSystemPhotometry | undefined,
  alphaRad: number,
  viewerElevationDeg: number,
  hostElevationDeg: number,
  globe: PhaseCoefficients | undefined,
): number {
  if (!photometry || !globe) return 1;
  const { betaDeg, backlit } = effectiveRingTiltDeg(
    photometry, viewerElevationDeg, hostElevationDeg,
  );
  return 1 + ringFluxRatio(photometry, alphaRad / DEG, betaDeg, backlit, globe);
}

/**
 * Largest flux factor the ring term can ever reach: maximum opening at
 * opposition. The per-host distance cull reads a static bound and would
 * otherwise drop a Saturn about to brighten through a ring opening.
 */
export function maxRingSystemFluxFactor(
  photometry: RingSystemPhotometry | undefined,
  globe: PhaseCoefficients | undefined,
): number {
  if (!photometry || !globe) return 1;
  return 1 + ringFluxRatio(photometry, 0, photometry.betaMaxDeg, false, globe);
}
