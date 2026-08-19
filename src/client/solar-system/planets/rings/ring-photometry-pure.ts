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
 * Ring flux at (α, β), in units of the **globe's own flux at α = 0** —
 * the same unit `empiricalPhaseFactor` reports the globe in, so the two
 * simply add to give the system's φ(α). The joint law gives the system
 * in that unit; subtracting the globe curve leaves the rings.
 *
 * Past the joint fit's `alphaMaxDeg` the ring flux becomes anchor-scaled
 * Lambert — the convention `empiricalPhaseFactor` uses past a globe
 * polynomial's bound. It extends the ring FLUX and not the ring/globe
 * ratio, which would compound Lambert with the globe's own curve and
 * bury the rings (3.4x too faint by α = 90°). The law's α slope is the
 * ring opposition surge, spent by ~2°, and the paper states outright
 * that there is not enough information to extend the system magnitude
 * beyond 6.5°, so nothing measured is discarded.
 *
 * Floored at zero: `globeZeroPointDelta` separates two independently
 * determined zero points (2012 photometry against 2017 synthetic
 * spectrophotometry), and below β ≈ 0.94° it swamps the tilt term and
 * would leave the rings emitting negative flux. 0.036 mag is inside the
 * mutual uncertainty of the two determinations, so it is a calibration
 * offset to floor, not an edge-on ring occultation to model.
 */
export function ringFluxAt(
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
  const system = Math.exp(
    -(photometry.globeZeroPointDelta + dvSystem) * 0.4 * LOG10,
  );
  let flux = Math.max(0, system - Math.exp(-phaseDV(globe, aCap) * 0.4 * LOG10));
  if (alphaDeg > photometry.alphaMaxDeg) {
    flux *=
      lambertianPhaseFactor(Math.min(alphaDeg, 180) * DEG) /
      lambertianPhaseFactor(photometry.alphaMaxDeg * DEG);
  }
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
 * The drawn annulus's phase scalar: ring flux at α over ring flux at
 * opposition, so **1 at α = 0** — the anchor the strip's RGB already
 * carries, a ~0.05 particle *geometric* albedo (data/textures/README.md
 * § Ring strips), which is by definition the zero-phase value. Without
 * this the strip renders its opposition brightness at every phase angle.
 *
 * Driving it from the same law as `ringFluxFor` rather than from an
 * independent fit is what keeps the resolvedness band stepless — inside
 * it the billboard and the annulus both draw. The backlit factor cancels
 * out of the quotient, and `planet-rings.frag.glsl` owns that split
 * itself through `TRANSMIT`.
 *
 * 1 when there is no ring photometry, or when β is edge-on enough that
 * the floored flux leaves no curve to normalise against.
 */
export function ringPhaseFactor(
  photometry: RingSystemPhotometry | undefined,
  alphaRad: number,
  viewerElevationDeg: number,
  hostElevationDeg: number,
  globe: PhaseCoefficients | undefined,
): number {
  if (!photometry || !globe) return 1;
  const { betaDeg } = effectiveRingTiltDeg(
    photometry, viewerElevationDeg, hostElevationDeg,
  );
  const atOpposition = ringFluxAt(photometry, 0, betaDeg, false, globe);
  if (atOpposition <= 0) return 1;
  return ringFluxAt(photometry, alphaRad / DEG, betaDeg, false, globe) / atOpposition;
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
  return 1 + ringFluxAt(photometry, 0, photometry.betaMaxDeg, false, globe);
}
