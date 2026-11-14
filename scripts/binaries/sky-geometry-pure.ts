// Sky geometry the binaries stages share: tangent-plane offsets and the (ρ, θ) one, chord tolerance tests, WDS (ρ, θ) prediction, parallax distance.

import { ARCSEC_PER_DEG, DEG_TO_RAD, HIPPARCOS_EPOCH_JYEAR } from '../../src/astro-core/astronomy-constants';
import type { SkyPosition, UnitVector } from '../../src/astro-core/equatorial-basis';
import type { MeasuredOffset } from '../wds/wds-pure';
import { pyMod } from './python-float-pure';

/** AT-HYG documents J2000.0, but its HIP-sourced rows sit at HIP1's J1991.25
 *  (α Cen A's stored RA is HIP1's 219.92041, not J2000's 219.9020); a row
 *  genuinely at J2000 moves under tolerance when propagated from here. */
export const ATHYG_REFERENCE_EPOCH = HIPPARCOS_EPOCH_JYEAR;

/** WDS precise_coord (cols 113-130) is one J2000 system coordinate shared by
 *  every pair row of a system, whatever each row's `date_last`. */
export const WDS_PRECISE_COORD_EPOCH = 2000.0;

export const COS_DEC_FLOOR = 1e-3;

export interface TangentOffset {
  eastArcsec: number;
  northArcsec: number;
}

/** A WDS (ρ, θ) as a tangent-plane offset: θ east of north, ρ in arcsec. */
export function polarToTangent(rhoArcsec: number, thetaDeg: number): TangentOffset {
  const theta = thetaDeg * DEG_TO_RAD;
  return { eastArcsec: rhoArcsec * Math.sin(theta), northArcsec: rhoArcsec * Math.cos(theta) };
}

/** Small-angle tangent-plane offset of `pos` from `ref`, RA wrapped to ±180°. */
export function tangentOffset(pos: SkyPosition, ref: SkyPosition): TangentOffset {
  const dRa = pyMod(pos.raDeg - ref.raDeg + 180, 360) - 180;
  return {
    eastArcsec: dRa * Math.cos(ref.decDeg * DEG_TO_RAD) * ARCSEC_PER_DEG,
    northArcsec: (pos.decDeg - ref.decDeg) * ARCSEC_PER_DEG,
  };
}

/** Squared chord between two directions on the unit sphere: monotone in
 *  their angular separation, so it compares against a tolerance without trig. */
export function unitChordSq(u: UnitVector, v: UnitVector): number {
  const dx = u.x - v.x;
  const dy = u.y - v.y;
  const dz = u.z - v.z;
  return dx * dx + dy * dy + dz * dz;
}

/** The squared chord subtending `toleranceArcsec`. */
export function chordSqForTolerance(toleranceArcsec: number): number {
  return (2 * Math.sin(((toleranceArcsec / ARCSEC_PER_DEG) * DEG_TO_RAD) / 2)) ** 2;
}

export function directionsWithin(a: UnitVector, b: UnitVector, toleranceArcsec: number): boolean {
  return unitChordSq(a, b) <= chordSqForTolerance(toleranceArcsec);
}

/** `primary` offset by a WDS (ρ, θ): θ east of north, ρ in arcsec, small-angle. */
export function predictSecondaryPosition(primary: SkyPosition, { rhoArcsec, thetaDeg }: MeasuredOffset): SkyPosition {
  const thetaRad = thetaDeg * DEG_TO_RAD;
  const rhoDeg = rhoArcsec / ARCSEC_PER_DEG;
  const cosDec = Math.max(Math.cos(primary.decDeg * DEG_TO_RAD), COS_DEC_FLOOR);
  return {
    raDeg: pyMod(primary.raDeg + (rhoDeg * Math.sin(thetaRad)) / cosDec, 360),
    decDeg: primary.decDeg + rhoDeg * Math.cos(thetaRad),
  };
}

/** 1000 / parallax; null for an absent or non-positive parallax. */
export function distancePc(plxMas: number | null): number | null {
  return plxMas === null || plxMas <= 0 ? null : 1000 / plxMas;
}
