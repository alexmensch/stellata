// The focused object's own orbit as an ICRS frame — plane normal plus the
// direction to the orbit's centre. See README.md § Levelling on an orbit.

import * as THREE from 'three';
import type { Stellata } from '../stellata';
import type { Target } from '../camera/focus/focus-target';
import { starOrbitNormalIcrs } from '../binaries/orbit-relation-cache';

const systemXyz = { x: 0, y: 0, z: 0 };

export interface FocusedOrbit {
  /** Unit ICRS normal — the orbit's angular-momentum direction. */
  readonly normal: THREE.Vector3;
  /** From the object toward the centre of its orbit: its host star or
   *  parent body, or its pair's barycentre. Unnormalised, and it lies in
   *  the orbital plane. */
  readonly toCentre: THREE.Vector3;
}

/** Fill `out` with the orbit the focused object itself rides, or false when
 *  it rides none the model has measured elements for.
 *  README.md § Levelling on an orbit.
 *
 *  Never route a body through `orbitalPlaneNormalFor`: it answers per HOST
 *  STAR, so every solar-system object would come back on the ecliptic while
 *  looking like a working feature. */
export function focusedOrbitInto(
  out: FocusedOrbit,
  stellata: Stellata,
  target: Target | null,
): boolean {
  if (target === null) return false;
  if (target.kind === 'planet') {
    const field = stellata.kinds.planet?.field;
    if (field === undefined) return false;
    return field.orbitPlaneNormalOf(target.idx, stellata.getT(), out.normal)
      && field.orbitCentreOffsetInto(target.idx, out.toCentre);
  }
  if (target.kind === 'star') {
    const binaries = stellata.getBinaries();
    if (binaries === null) return false;
    const pos = stellata.catalog.positions;
    const base = target.idx * 3;
    if (base < 0 || base + 2 >= pos.length) return false;
    systemXyz.x = pos[base];
    systemXyz.y = pos[base + 1];
    systemXyz.z = pos[base + 2];
    const plane = starOrbitNormalIcrs(binaries, target.idx, systemXyz);
    if (plane === null) return false;
    const local = stellata.localPositions;
    const pBase = plane.partnerIdx * 3;
    if (pBase < 0 || pBase + 2 >= local.length) return false;
    const sBase = target.idx * 3;
    // The barycentre lies on the segment between the pair's two members, so
    // the partner's direction IS the direction to the orbit's centre — the
    // mass split only sets how far along, which a longitude datum drops.
    // Riding an ancestor pair, the focused star sits inside one member's
    // subsystem rather than on it; that subsystem is nested well inside the
    // orbit it rides, so it moves the direction by far less than the datum
    // resolves.
    out.toCentre.set(
      local[pBase + 0] - local[sBase + 0],
      local[pBase + 1] - local[sBase + 1],
      local[pBase + 2] - local[sBase + 2],
    );
    out.normal.set(plane.normal.x, plane.normal.y, plane.normal.z).normalize();
    return true;
  }
  return false;
}
