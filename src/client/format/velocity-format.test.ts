import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { galacticDirToIcrs } from '../galactic/galactic-coords';
import { formatSpaceVelocity, KMS_PER_PC_YR, spaceVelocity } from './velocity-format';

// Build an ICRS velocity whose galactic heading is (l, b) by rotating a
// galactic-frame unit vector through the same transform the grid uses —
// spaceVelocity must invert it exactly.
function icrsVelocity(lDeg: number, bDeg: number, magPcYr: number): THREE.Vector3 {
  const v = new THREE.Vector3();
  galacticDirToIcrs((lDeg * Math.PI) / 180, (bDeg * Math.PI) / 180, v);
  return v.multiplyScalar(magPcYr);
}

describe('spaceVelocity', () => {
  it('recovers the galactic heading of the velocity vector', () => {
    const v = icrsVelocity(87, -12, 1e-5);
    const out = spaceVelocity(v.x, v.y, v.z)!;
    expect(out.lDeg).toBeCloseTo(87, 5);
    expect(out.bDeg).toBeCloseTo(-12, 5);
  });

  it('converts pc/yr to km/s', () => {
    // 1 pc/yr = 3.0857e13 km / 3.15576e7 s.
    expect(KMS_PER_PC_YR).toBeCloseTo(977792.22, 2);
    const v = icrsVelocity(0, 0, 2.5e-5);
    expect(spaceVelocity(v.x, v.y, v.z)!.kms).toBeCloseTo(2.5e-5 * KMS_PER_PC_YR, 8);
  });

  it('wraps longitude into [0, 360)', () => {
    const v = icrsVelocity(-90, 0, 1e-5);
    expect(spaceVelocity(v.x, v.y, v.z)!.lDeg).toBeCloseTo(270, 5);
  });

  it('returns null for zero or non-finite motion', () => {
    expect(spaceVelocity(0, 0, 0)).toBeNull();
    expect(spaceVelocity(NaN, 0, 0)).toBeNull();
  });
});

describe('formatSpaceVelocity', () => {
  it('rounds to whole degrees with a signed latitude, heading on its own line', () => {
    expect(
      formatSpaceVelocity({ kms: 24.3, lDeg: 87.2, bDeg: -11.8 }),
    ).toBe('24 km/s\nℓ 87° · b -12°');
    expect(
      formatSpaceVelocity({ kms: 13.9, lDeg: 56.6, bDeg: 8.9 }),
    ).toBe('14 km/s\nℓ 57° · b +9°');
  });
});
