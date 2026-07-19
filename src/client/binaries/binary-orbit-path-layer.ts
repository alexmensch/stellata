// Focus-gated orbital-path ellipses for the members of the focused
// multi-star system. See src/client/binaries/README.md § Binary orbit paths.

import * as THREE from 'three';
import { AU_PC } from '../util/astronomy-constants';
import { type BinariesData } from './binaries-loader';
import { keplerRelationParams, relationIndicesInBounds } from './orbit-relation-cache';
import { keplerChainRelationIdxs, buildBinaryOrbitRingPoints } from './binary-orbit-path-pure';
import {
  makeOrbitLineMaterial,
  makeOrbitLineLoop,
  ORBIT_LINE_SEGMENTS,
  pixelsPerRadian,
  angularRadiusPx,
} from '../util/orbit-line';

const PATH_COLOUR = 0x9fc2d6;
// Below the star discs (renderOrder 0) so a disc composites over the path
// where a member sits on it; above the galactic disc / grid (−1).
const PATH_RENDER_ORDER = -0.5;
// Hide a pair once its larger ellipse subtends less than this on-screen
// radius: at that size the orbit no longer reads as a loop, and the focus
// ring (24 px) takes back over as the "you are here" marker.
const PATH_MIN_RADIUS_PX = 24;

interface OrbitPathPair {
  readonly primaryIdx: number;
  readonly secondaryIdx: number;
  /** Secondary mass fraction M_s/(M_p+M_s); drives the barycentre split. */
  readonly q: number;
  /** Larger member's ellipse semi-major (pc) — the on-screen-size proxy
   *  for the per-frame visibility gate. */
  readonly charSizePc: number;
  readonly group: THREE.Group;
  readonly primaryLoop: THREE.LineLoop;
  readonly secondaryLoop: THREE.LineLoop;
}

/**
 * One `LineLoop` pair per Kepler relation on the focused star's chain —
 * each member's barycentric ellipse. Mirrors `OrbitRingsLayer`: an
 * event-driven rebuild (`setSystem` on focus change) plus a per-frame
 * barycentre reposition from the walked local positions.
 */
export class BinaryOrbitPathLayer {
  readonly group: THREE.Group;
  private material: THREE.LineBasicMaterial;
  private pairs: OrbitPathPair[] = [];
  // Detail-cycle permission (floor 'representational'); false hides the
  // paths even while a system is focused.
  private permitted = true;
  // Whether the last update() left any pair above the on-screen-size gate.
  private anyVisible = false;

  constructor() {
    this.group = new THREE.Group();
    this.group.renderOrder = PATH_RENDER_ORDER;
    this.group.visible = false;
    this.material = makeOrbitLineMaterial(PATH_COLOUR);
  }

  /**
   * Rebuild the paths for the focused system's Kepler pairs. Visual
   * companions (no elements) and unfocused systems yield none. Rebuilds
   * geometry — call on focus change, not per frame. `absolutePositions`
   * anchors each Tier-1 tangent basis at its system's ICRS direction.
   */
  setSystem(
    binaries: BinariesData | null,
    focalIdx: number | null,
    absolutePositions: Float32Array,
  ): void {
    this.disposePairs();
    if (binaries === null) {
      this.group.visible = false;
      return;
    }
    for (const ri of keplerChainRelationIdxs(binaries, focalIdx)) {
      const r = binaries.relations[ri];
      const params = keplerRelationParams(r);
      if (params === null) continue;
      if (!relationIndicesInBounds(r, absolutePositions.length)) continue;
      const pBase = r.primaryIdx * 3;
      const { primary, secondary } = buildBinaryOrbitRingPoints(
        params.elements,
        params.tier,
        { x: absolutePositions[pBase], y: absolutePositions[pBase + 1], z: absolutePositions[pBase + 2] },
        ORBIT_LINE_SEGMENTS,
      );
      const g = new THREE.Group();
      const primaryLoop = makeOrbitLineLoop(primary, this.material, this.group.renderOrder);
      const secondaryLoop = makeOrbitLineLoop(secondary, this.material, this.group.renderOrder);
      g.add(primaryLoop);
      g.add(secondaryLoop);
      this.group.add(g);
      this.pairs.push({
        primaryIdx: r.primaryIdx,
        secondaryIdx: r.secondaryIdx,
        q: params.elements.q,
        charSizePc: Math.max(params.elements.q, 1 - params.elements.q) * params.elements.a * AU_PC,
        group: g,
        primaryLoop,
        secondaryLoop,
      });
    }
    this.group.visible = this.permitted && this.pairs.length > 0;
  }

  /**
   * Per-frame barycentre reposition + on-screen-size visibility gate. Must
   * run AFTER `BinaryOrbitField.update()` writes this frame's slots, so
   * each ellipse rides its pair's live drift and the two members sit on
   * their own paths. A pair hides once its orbit shrinks below
   * `PATH_MIN_RADIUS_PX` (zoom-out / distant system), mirroring the planet
   * orbit rings' pixel gate.
   */
  update(localPositions: Float32Array, camera: THREE.PerspectiveCamera, viewportHeightPx: number): void {
    if (!this.permitted || this.pairs.length === 0) {
      this.group.visible = false;
      this.anyVisible = false;
      return;
    }
    this.group.visible = true;
    const pxPerRad = pixelsPerRadian(camera.fov, viewportHeightPx);
    let anyVisible = false;
    for (const p of this.pairs) {
      const pB = p.primaryIdx * 3;
      const sB = p.secondaryIdx * 3;
      const primaryFrac = 1 - p.q;
      p.group.position.set(
        primaryFrac * localPositions[pB] + p.q * localPositions[sB],
        primaryFrac * localPositions[pB + 1] + p.q * localPositions[sB + 1],
        primaryFrac * localPositions[pB + 2] + p.q * localPositions[sB + 2],
      );
      const dPc = camera.position.distanceTo(p.group.position);
      const visible = angularRadiusPx(p.charSizePc, dPc, pxPerRad) >= PATH_MIN_RADIUS_PX;
      p.group.visible = visible;
      if (visible) anyVisible = true;
    }
    this.anyVisible = anyVisible;
  }

  setPermitted(on: boolean): void {
    this.permitted = on;
    if (!on) this.group.visible = false;
  }

  /**
   * True when at least one of the focused system's paths is drawn AND
   * large enough on screen to read as an orbit. The focus ring overlay
   * reads this (via `Stellata.anyOrbitRingVisible`) to suppress itself
   * while the paths mark the focal star — mirrors
   * `OrbitRingsLayer.anyOrbitRingVisible`.
   */
  anyOrbitRingVisible(): boolean {
    return this.permitted && this.group.visible && this.anyVisible;
  }

  dispose(): void {
    this.disposePairs();
    this.material.dispose();
  }

  private disposePairs(): void {
    for (const p of this.pairs) {
      this.group.remove(p.group);
      p.primaryLoop.geometry.dispose();
      p.secondaryLoop.geometry.dispose();
    }
    this.pairs = [];
  }
}
