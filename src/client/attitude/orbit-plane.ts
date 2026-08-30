// The orbital plane of the focused object as an ICRS normal — the
// double-click level target. See README.md § Levelling on an orbit.

import * as THREE from 'three';
import type { Stellata } from '../stellata';
import type { Target } from '../camera/focus/focus-target';
import { starOrbitNormalIcrs } from '../binaries/orbit-relation-cache';

const systemXyz = { x: 0, y: 0, z: 0 };

/** Unit ICRS normal of the orbit the focused object itself rides, or
 *  false when it rides none the model has measured elements for.
 *
 *  Always the INNERMOST orbit the object is on: Luna's about Earth, not
 *  Earth's about Sol; Algol Aa2's tight inner pair, not the wide Aa-Ab
 *  one its primary also belongs to. Each subsystem answers from its own
 *  elements — there is no cross-kind orbit accessor, and the per-host
 *  `orbitalPlaneNormalFor` is not one: it answers for the HOST STAR, so
 *  every solar-system body would come back on the ecliptic. */
export function focusedOrbitNormalInto(
  out: THREE.Vector3,
  stellata: Stellata,
  target: Target | null,
): boolean {
  if (target === null) return false;
  if (target.kind === 'planet') {
    const field = stellata.kinds.planet?.field;
    return field?.orbitPlaneNormalOf(target.idx, stellata.getT(), out) ?? false;
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
    const n = starOrbitNormalIcrs(binaries, target.idx, systemXyz);
    if (n === null) return false;
    out.set(n.x, n.y, n.z).normalize();
    return true;
  }
  return false;
}
