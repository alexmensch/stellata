// Instance-registration seam for boundary-shell focus targets. See
// ./README.md § Boundary shells as focus targets.

import * as THREE from 'three';

import { parkDistance, viewingDistanceForExtent } from '../camera/focus/focus-transition';

/** Canonical shell order. A shell's `Target.idx`, its SID-domain local
 *  index, and its `SHELL_OBJECT_SIDS` pin all key off this array — the
 *  three must stay aligned. Append only; never reorder. */
export const SHELL_KEYS = ['local_bubble', 'heliopause'] as const;
export type ShellKey = (typeof SHELL_KEYS)[number];

/** Static focus-card fields for a shell (non-luminous, so no magnitude
 *  rows). Distance is computed generically camera→center, not carried
 *  here. */
export interface ShellCardInfo {
  /** Identity line under the header — the object's type descriptor. */
  typeLine: string;
  /** "Size" row value. */
  size: string;
  /** "Known from" row value. */
  knownFrom: string;
}

/** Silhouette samples + label id a shell exposes for the shared
 *  bbox pick (fresnel-shell/shell-pick.ts). Same sample set the shell's
 *  silhouette label already uses, so the hit surface matches what's drawn. */
export interface ShellPickSurface {
  /** DOM id of the shell's SVG label — an alternate hit surface. */
  labelElementId: string;
  /** Whether the shell is currently drawn — picks fire only when it is,
   *  so a decluttered / chart-hidden shell isn't hoverable. */
  visible(): boolean;
  sampleCount(): number;
  /** Silhouette sample `i` in the renderer's local frame (absolute −
   *  worldOffset), written into `out`. */
  sampleLocalInto(i: number, worldOffset: THREE.Vector3, out: THREE.Vector3): void;
}

/** Everything the kind-agnostic shell dispatch needs for one instance,
 *  populated by that shell's layer when it attaches. */
export interface ShellInstance {
  label: string;
  sid: number;
  card: ShellCardInfo;
  /** Absolute ICRS center (pc); false when the layer's geometry isn't
   *  available yet (mirrors the lg loader's null-artifact contract). */
  centerAbsInto(out: THREE.Vector3): boolean;
  /** Representative radius (pc) fed to `viewingDistanceForExtent` for
   *  park framing. */
  extentPc(): number;
  /** Silhouette + label hit surface for click / hover picks. */
  pick: ShellPickSurface;
}

/** Fixed-slot registry the two boundary shells populate. Slots exist
 *  for every `SHELL_KEYS` entry so `Target.idx` ↔ SID local index stay
 *  stable regardless of which artifacts loaded; an absent shell simply
 *  has no slot and dispatches fall through to null. */
export class ShellRegistry {
  private readonly slots = new Map<ShellKey, ShellInstance>();
  private readonly tmp = new THREE.Vector3();

  register(key: ShellKey, instance: ShellInstance): void {
    this.slots.set(key, instance);
  }

  at(idx: number): ShellInstance | null {
    const key = SHELL_KEYS[idx];
    return key ? (this.slots.get(key) ?? null) : null;
  }

  get count(): number {
    return SHELL_KEYS.length;
  }

  /** Shell center in the renderer's local frame (absolute − worldOffset).
   *  false when the shell or its geometry is absent — the shell provider's
   *  localPositionInto leg. */
  localPositionInto(idx: number, worldOffset: THREE.Vector3, out: THREE.Vector3): boolean {
    const shell = this.at(idx);
    if (!shell || !shell.centerAbsInto(out)) return false;
    out.sub(worldOffset);
    return true;
  }

  /** Live camera→center distance in the local frame, pc; 0 when absent. */
  cameraDistancePc(idx: number, worldOffset: THREE.Vector3, cameraPos: THREE.Vector3): number {
    if (!this.localPositionInto(idx, worldOffset, this.tmp)) return 0;
    return this.tmp.distanceTo(cameraPos);
  }

  /** Camera-to-center distance that frames the whole shell — the
   *  FocusTarget.parkRadius leg (= the distance the hide-when-inside wall
   *  becomes visible). 0 when absent. floorPc=0: shells span AU (helio-
   *  pause) to hundreds of pc, so the default 5 pc floor would park the
   *  camera ~1e6 AU from the ~200 AU heliopause; `2.4 × extent` governs,
   *  and `controls.minDistance` is the real close-approach floor. */
  viewingDistancePc(idx: number): number {
    const shell = this.at(idx);
    return shell ? viewingDistanceForExtent(shell.extentPc(), 0) : 0;
  }

  /** Focus-park lerp landing distance — the FocusableProvider leg. 0 when
   *  absent. */
  focusParkDistancePc(idx: number): number {
    const shell = this.at(idx);
    if (!shell) return 0;
    const extent = shell.extentPc();
    return parkDistance({ R_pc: extent, dMinFloor: viewingDistanceForExtent(extent, 0) });
  }

  /** Projected shell diameter in px from its extent radius — chevron /
   *  silhouette sizing. 0 when absent. */
  renderedSizePx(
    idx: number,
    worldOffset: THREE.Vector3,
    cameraPos: THREE.Vector3,
    angularToPx: number,
  ): number {
    const shell = this.at(idx);
    if (!shell || !this.localPositionInto(idx, worldOffset, this.tmp)) return 0;
    const dCam = Math.max(this.tmp.distanceTo(cameraPos), 1);
    return 2 * Math.atan(shell.extentPc() / dCam) * angularToPx;
  }
}
