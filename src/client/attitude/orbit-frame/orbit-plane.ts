// The focused object's own orbit as an ICRS frame — plane normal plus the
// direction to the orbit's centre. See README.md § Levelling on an orbit.

import * as THREE from 'three';
import type { Stellata } from '../../stellata';
import type { Target } from '../../camera/focus/focus-target';
import { starOrbitNormalIcrs } from '../../binaries/orbit-relation-cache';

const systemXyz = { x: 0, y: 0, z: 0 };

export interface FocusedOrbit {
  /** Unit ICRS normal — the orbit's angular-momentum direction. */
  readonly normal: THREE.Vector3;
  /** From the object toward the centre of its orbit: its host star or
   *  parent body, or its pair's barycentre. Unnormalised, and it lies in
   *  the orbital plane. */
  readonly toCentre: THREE.Vector3;
}

/** Which subsystem answers for the focused object's orbit, plus whatever
 *  about that orbit does not move. Resolved once per focus so the per-frame
 *  rebuild ORB runs on (README.md § Orbit rate) does no work it can avoid.
 *
 *  A **pair** carries its normal: an orbit is planar and the elements are
 *  frozen, so the only live quantity is the direction to the partner. A
 *  **planet** carries none — a precessing node moves its plane, so a moon's
 *  normal is genuinely a function of `t` and is re-read per frame. */
export type FocusedOrbitSource =
  | { readonly kind: 'planet'; readonly bodyIdx: number }
  | {
    readonly kind: 'pair';
    readonly starIdx: number;
    readonly partnerIdx: number;
    readonly normal: THREE.Vector3;
  };

/** Resolve which orbit the focused object rides, or null when it rides none
 *  the model has elements for. Cheap to retry: a caller holding the answer
 *  across frames should re-ask while it is null, since the binaries artifact
 *  and the planet kind both attach after a focus can be set.
 *
 *  Never route a body through `orbitalPlaneNormalFor`: it answers per HOST
 *  STAR, so every solar-system object would come back on the ecliptic while
 *  looking like a working feature. */
export function resolveFocusedOrbit(
  stellata: Stellata,
  target: Target | null,
): FocusedOrbitSource | null {
  if (target === null) return null;
  if (target.kind === 'planet') {
    return stellata.kinds.planet?.field === undefined
      ? null
      : { kind: 'planet', bodyIdx: target.idx };
  }
  if (target.kind !== 'star') return null;
  const binaries = stellata.getBinaries();
  if (binaries === null) return null;
  const pos = stellata.catalog.positions;
  const base = target.idx * 3;
  if (base < 0 || base + 2 >= pos.length) return null;
  systemXyz.x = pos[base];
  systemXyz.y = pos[base + 1];
  systemXyz.z = pos[base + 2];
  const plane = starOrbitNormalIcrs(binaries, target.idx, systemXyz);
  if (plane === null) return null;
  const r = binaries.relations[plane.relationIdx];
  return {
    kind: 'pair',
    starIdx: target.idx,
    partnerIdx: r.primaryIdx === target.idx ? r.secondaryIdx : r.primaryIdx,
    normal: new THREE.Vector3(plane.normal.x, plane.normal.y, plane.normal.z).normalize(),
  };
}

/** Fill `out` from an already-resolved source, or false when the positions it
 *  needs will not resolve — an object whose artifact has not attached answers
 *  false rather than a stale point. This is the per-rendered-frame half. */
export function focusedOrbitFrom(
  out: FocusedOrbit,
  source: FocusedOrbitSource,
  stellata: Stellata,
): boolean {
  if (source.kind === 'planet') {
    const field = stellata.kinds.planet?.field;
    if (field === undefined) return false;
    return field.orbitPlaneNormalOf(source.bodyIdx, stellata.getT(), out.normal)
      && field.orbitCentreOffsetInto(source.bodyIdx, out.toCentre);
  }
  const local = stellata.localPositions;
  const pBase = source.partnerIdx * 3;
  const sBase = source.starIdx * 3;
  if (pBase < 0 || pBase + 2 >= local.length) return false;
  // The barycentre lies on the segment between the two members, so the
  // partner's direction IS the direction to the orbit's centre — the
  // mass split only sets how far along, which a longitude datum drops.
  out.toCentre.set(
    local[pBase + 0] - local[sBase + 0],
    local[pBase + 1] - local[sBase + 1],
    local[pBase + 2] - local[sBase + 2],
  );
  out.normal.copy(source.normal);
  return true;
}

/** Resolve and fill in one call, for the gesture and availability paths that
 *  ask once. The per-frame path holds the source instead. */
export function focusedOrbitInto(
  out: FocusedOrbit,
  stellata: Stellata,
  target: Target | null,
): boolean {
  const source = resolveFocusedOrbit(stellata, target);
  return source !== null && focusedOrbitFrom(out, source, stellata);
}
