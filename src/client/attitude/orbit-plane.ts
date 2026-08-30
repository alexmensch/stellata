// The focused object's own orbit as an ICRS frame — plane normal plus the
// direction to the orbit's centre. See README.md § Levelling on an orbit.

import * as THREE from 'three';
import type { Stellata } from '../stellata';
import type { Target } from '../camera/focus/focus-target';
import { starOrbitNormalIcrs } from '../binaries/orbit-relation-cache';
import { innermostRelationOf } from '../binaries/focal-chain';
import { NO_PARENT } from '../binaries/binaries-loader';

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
 *
 *  Always the INNERMOST orbit the object is on: Luna's about Earth, not
 *  Earth's about Sol; Algol Aa2's tight inner pair, not the wide Aa-Ab
 *  one its primary also belongs to. Each subsystem answers from its own
 *  elements — there is no cross-kind orbit accessor, and the per-host
 *  `orbitalPlaneNormalFor` is not one: it answers for the HOST STAR, so
 *  every solar-system body would come back on the ecliptic. */
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
    const n = starOrbitNormalIcrs(binaries, target.idx, systemXyz);
    if (n === null) return false;
    const ri = innermostRelationOf(binaries, target.idx);
    if (ri === NO_PARENT) return false;
    const r = binaries.relations[ri];
    const partnerIdx = r.primaryIdx === target.idx ? r.secondaryIdx : r.primaryIdx;
    const local = stellata.localPositions;
    const pBase = partnerIdx * 3;
    if (pBase < 0 || pBase + 2 >= local.length) return false;
    const sBase = target.idx * 3;
    // The barycentre lies on the segment between the two members, so the
    // partner's direction IS the direction to the orbit's centre — the
    // mass split only sets how far along, which a longitude datum drops.
    out.toCentre.set(
      local[pBase + 0] - local[sBase + 0],
      local[pBase + 1] - local[sBase + 1],
      local[pBase + 2] - local[sBase + 2],
    );
    out.normal.set(n.x, n.y, n.z).normalize();
    return true;
  }
  return false;
}
