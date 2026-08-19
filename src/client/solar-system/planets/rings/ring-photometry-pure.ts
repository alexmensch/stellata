// Ring-system contribution to a ringed body's unresolved apparent
// magnitude: Mallama & Hilton's joint phase-angle / ring-tilt law.
// See README.md § Ring photometry.

import {
  lambertianPhaseFactor,
  magToFlux,
  phaseFactorAt,
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
  /** Upper β bound of the published joint fit, degrees. Doubles as the
   *  reference tilt the one phase shape is evaluated at. */
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
 * opposite side of the ring plane from the host. Pinned to the
 * `TRANSMIT` the annulus shader dims its unlit face by, which is what
 * keeps the point-source and resolved models agreeing on which side is
 * lit. README.md § Three places the published fit runs out.
 */
export const RING_BACKLIT_TRANSMIT = 0.35;

const DEG = Math.PI / 180;

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

/** The joint law's system magnitude at (α, β), against the globe-alone
 *  zero point the body's `phaseCoefficients` are anchored to. α is
 *  capped at the fit's bound; callers extend past it themselves. */
function systemDV(
  photometry: RingSystemPhotometry,
  alphaDeg: number,
  betaDeg: number,
): number {
  const aCap = Math.min(Math.max(0, alphaDeg), photometry.alphaMaxDeg);
  const sinB = Math.sin(betaDeg * DEG);
  return (
    photometry.globeZeroPointDelta +
    photometry.tiltMag * sinB +
    photometry.alphaSlope * aCap +
    photometry.surgeMag * sinB * Math.exp(photometry.surgeDecayPerDeg * aCap)
  );
}

/** Ring flux inside the joint fit's α bound: the system the law gives,
 *  less the globe curve, in units of the globe's own flux at α = 0.
 *  Floored at zero — the law and the globe curve carry independently
 *  determined zero points. README.md § Ring photometry. */
function ringFluxInFit(
  photometry: RingSystemPhotometry,
  alphaDeg: number,
  betaDeg: number,
  globe: PhaseCoefficients,
): number {
  const aCap = Math.min(Math.max(0, alphaDeg), photometry.alphaMaxDeg);
  return Math.max(
    0,
    magToFlux(systemDV(photometry, aCap, betaDeg)) -
      phaseFactorAt(globe, aCap * DEG),
  );
}

/**
 * The ring system's flux at opposition, in units of the **globe's own
 * flux at α = 0** — the amplitude the one phase shape scales. Floors at
 * zero below β ≈ 0.94°, where the 0.036 mag between the two papers'
 * zero points swamps the tilt term. README.md § Ring photometry.
 */
export function ringOppositionFlux(
  photometry: RingSystemPhotometry,
  betaDeg: number,
  globe: PhaseCoefficients,
): number {
  return ringFluxInFit(photometry, 0, betaDeg, globe);
}

/**
 * The ring phase curve's α-response, normalised to 1 at opposition and
 * evaluated at the fit's own `betaMaxDeg` — one shape for every tilt.
 * Past `alphaMaxDeg` it continues as anchor-scaled Lambert.
 * README.md § One shape, scaled by one amplitude.
 */
export function ringPhaseShape(
  photometry: RingSystemPhotometry,
  alphaDeg: number,
  globe: PhaseCoefficients,
): number {
  const betaRef = photometry.betaMaxDeg;
  const reference = ringFluxInFit(photometry, 0, betaRef, globe);
  if (reference <= 0) return lambertianPhaseFactor(alphaDeg * DEG);
  const shape = ringFluxInFit(photometry, alphaDeg, betaRef, globe) / reference;
  if (alphaDeg <= photometry.alphaMaxDeg) return shape;
  const aClamped = Math.min(alphaDeg, 180);
  return (
    shape *
    (lambertianPhaseFactor(aClamped * DEG) /
      lambertianPhaseFactor(photometry.alphaMaxDeg * DEG))
  );
}

/**
 * Ring flux at (α, β), in units of the globe's own flux at α = 0 — the
 * opposition amplitude times the one phase shape, so every tilt rides
 * the same α-response. README.md § One shape, scaled by one amplitude.
 */
export function ringFluxAt(
  photometry: RingSystemPhotometry,
  alphaDeg: number,
  betaDeg: number,
  backlit: boolean,
  globe: PhaseCoefficients,
): number {
  const flux =
    ringOppositionFlux(photometry, betaDeg, globe) *
    ringPhaseShape(photometry, alphaDeg, globe);
  return backlit ? flux * RING_BACKLIT_TRANSMIT : flux;
}

/**
 * Ring flux for a body at a viewer, in the globe's α = 0 flux unit —
 * the number the apparent-magnitude formula ADDS to the globe's φ(α),
 * and the `iRingFlux` per-instance attribute. Adding rather than scaling
 * is what keeps it finite: as α → 180° both fluxes vanish, and their
 * ratio is 0/0.
 *
 * The law is a difference against a globe curve, so a body carrying ring
 * photometry without `phaseCoefficients` gets no ring term at all;
 * `planet-system.test.ts` pins the pairing so that cannot ship.
 */
export function ringFluxFor(
  photometry: RingSystemPhotometry | undefined,
  alphaRad: number,
  viewerElevationDeg: number,
  hostElevationDeg: number,
  globe: PhaseCoefficients | undefined,
): number {
  if (!photometry || !globe) return 0;
  const { betaDeg, backlit } = effectiveRingTiltDeg(
    photometry, viewerElevationDeg, hostElevationDeg,
  );
  return ringFluxAt(photometry, alphaRad / DEG, betaDeg, backlit, globe);
}

/**
 * The drawn annulus's phase scalar — the same shape `ringFluxFor` scales
 * its amplitude by, so the two surfaces cannot step against each other
 * inside the resolvedness band. 1 at opposition, which is the anchor the
 * strip's RGB already carries (a geometric albedo is by definition the
 * zero-phase value). README.md § The drawn annulus rides the same curve.
 */
export function ringPhaseFactor(
  photometry: RingSystemPhotometry | undefined,
  alphaRad: number,
  globe: PhaseCoefficients | undefined,
): number {
  if (!photometry || !globe) return 1;
  return ringPhaseShape(photometry, alphaRad / DEG, globe);
}

/**
 * Largest flux factor the ring system can ever multiply the globe's
 * reflectance by: maximum opening at opposition. The per-host distance
 * cull reads a static bound and would otherwise drop a Saturn about to
 * brighten through a ring opening.
 */
export function maxRingSystemFluxFactor(
  photometry: RingSystemPhotometry | undefined,
  globe: PhaseCoefficients | undefined,
): number {
  if (!photometry || !globe) return 1;
  return 1 + ringOppositionFlux(photometry, photometry.betaMaxDeg, globe);
}
