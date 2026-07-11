// Heliocentric space-velocity display — km/s magnitude + galactic ℓ/b
// heading of the velocity vector. See ./README.md.

import * as THREE from 'three';
import { ICRS_TO_GAL_M3 } from '../galactic/galactic-coords';
import { AU_KM, AU_PER_PC, DAYS_PER_JULIAN_YEAR } from '../util/astronomy-constants';

/** km/s per pc/yr — the catalog `velocities` unit onto the display unit. */
export const KMS_PER_PC_YR =
  (AU_PER_PC * AU_KM) / (DAYS_PER_JULIAN_YEAR * 86400);

export interface SpaceVelocity {
  /** Speed, km/s. */
  kms: number;
  /** Galactic longitude of the velocity vector's heading, degrees [0, 360). */
  lDeg: number;
  /** Galactic latitude of the heading, degrees [-90, +90]. */
  bDeg: number;
}

const SCRATCH = new THREE.Vector3();

/**
 * Speed + galactic heading of an equatorial-Cartesian space-motion
 * velocity (catalog units, pc/yr). The ℓ/b pair is the instantaneous
 * direction of travel — most disk stars cluster near ℓ ≈ 90° (galactic
 * rotation) plus peculiar motion. Null for a zero or non-finite vector
 * (no measured space motion).
 */
export function spaceVelocity(
  vxPcYr: number,
  vyPcYr: number,
  vzPcYr: number,
): SpaceVelocity | null {
  const mag = Math.hypot(vxPcYr, vyPcYr, vzPcYr);
  if (!Number.isFinite(mag) || mag === 0) return null;
  const v = SCRATCH.set(vxPcYr, vyPcYr, vzPcYr).applyMatrix3(ICRS_TO_GAL_M3);
  let lDeg = (Math.atan2(v.y, v.x) * 180) / Math.PI;
  if (lDeg < 0) lDeg += 360;
  const bDeg = (Math.asin(Math.min(1, Math.max(-1, v.z / mag))) * 180) / Math.PI;
  return { kms: mag * KMS_PER_PC_YR, lDeg, bDeg };
}

/** "24 km/s" over "ℓ 87° · b -12°" — the heading always takes its own
 *  line (whole degrees, signed latitude); consumers render the newline
 *  via `white-space: pre-line`. */
export function formatSpaceVelocity(v: SpaceVelocity): string {
  const b = Math.round(v.bDeg);
  const bStr = b >= 0 ? `+${b}` : `${b}`;
  return `${Math.round(v.kms)} km/s\nℓ ${Math.round(v.lDeg)}° · b ${bStr}°`;
}
