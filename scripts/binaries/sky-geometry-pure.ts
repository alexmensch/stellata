// Sky geometry the binaries stages share: proper-motion propagation, tangent-plane offsets, parallax distance.

import { DEG_TO_RAD } from '../../src/astro-core/astronomy-constants';
import type { SkyPosition } from '../../src/astro-core/equatorial-basis';

/** AT-HYG documents J2000.0, but its HIP-sourced rows sit at HIP1's J1991.25
 *  (α Cen A's stored RA is HIP1's 219.92041, not J2000's 219.9020); a row
 *  genuinely at J2000 moves under tolerance when propagated from here. */
export const ATHYG_REFERENCE_EPOCH = 1991.25;

/** WDS precise_coord (cols 113-130) is one J2000 system coordinate shared by
 *  every pair row of a system, whatever each row's `date_last`. */
export const WDS_PRECISE_COORD_EPOCH = 2000.0;

const MAS_PER_DEG = 3600 * 1000;
const COS_DEC_FLOOR = 1e-3;

/** Proper motion in mas/yr, μ_α* already cos δ-applied. */
export interface ProperMotion {
  pmRaMasyr: number | null;
  pmDecMasyr: number | null;
}

/** `x mod m` with the sign of `m`, as Python's `%` computes it — including
 *  its rounding up to `m` for a tiny negative `x`, which `((x % m) + m) % m`
 *  would wrap to 0. The Python stages' outputs are the byte-identity target. */
function pyMod(x: number, m: number): number {
  const r = x % m;
  if (r === 0) return 0;
  return (r < 0) !== (m < 0) ? r + m : r;
}

/** Linear propagation in RA/Dec degrees from `refEpoch` to `targetEpoch`. A
 *  position with either PM component missing comes back unmoved: no motion
 *  to propagate with, so the measured position is the best estimate. */
export function propagatePosition(
  pos: SkyPosition, pm: ProperMotion, refEpoch: number, targetEpoch: number,
): SkyPosition {
  if (pm.pmRaMasyr === null || pm.pmDecMasyr === null) return pos;
  const dt = targetEpoch - refEpoch;
  const cosDec = Math.max(Math.cos(pos.decDeg * DEG_TO_RAD), COS_DEC_FLOOR);
  return {
    raDeg: pyMod(pos.raDeg + (pm.pmRaMasyr * dt) / (MAS_PER_DEG * cosDec), 360),
    decDeg: pos.decDeg + (pm.pmDecMasyr * dt) / MAS_PER_DEG,
  };
}

export interface TangentOffset {
  eastArcsec: number;
  northArcsec: number;
}

/** Small-angle tangent-plane offset of `pos` from `ref`, RA wrapped to ±180°. */
export function tangentOffset(pos: SkyPosition, ref: SkyPosition): TangentOffset {
  const dRa = pyMod(pos.raDeg - ref.raDeg + 180, 360) - 180;
  return {
    eastArcsec: dRa * Math.cos(ref.decDeg * DEG_TO_RAD) * 3600,
    northArcsec: (pos.decDeg - ref.decDeg) * 3600,
  };
}

/** 1000 / parallax; null for an absent or non-positive parallax. */
export function distancePc(plxMas: number | null): number | null {
  return plxMas === null || plxMas <= 0 ? null : 1000 / plxMas;
}
