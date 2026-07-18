// Focus-gated orbital-path ellipses for the members of the focused
// multi-star system. See src/client/binaries/README.md § Binary orbit paths.

import * as THREE from 'three';
import { type BinariesData } from './binaries-loader';
import { keplerRelationParams } from './orbit-relation-cache';
import { keplerChainRelationIdxs, buildBinaryOrbitRingPoints } from './binary-orbit-path-pure';

const PATH_COLOUR = 0x9fc2d6;
const PATH_OPACITY = 0.5;
// Below the star discs (renderOrder 0) so a disc composites over the path
// where a member sits on it; above the galactic disc / grid (−1).
const PATH_RENDER_ORDER = -0.5;
// Vertices per ellipse — smooth at maximum zoom into a focused pair, and
// trivial at ≤3 pairs × 2 members per focused system.
const PATH_SEGMENTS = 128;

interface OrbitPathPair {
  readonly primaryIdx: number;
  readonly secondaryIdx: number;
  /** Secondary mass fraction M_s/(M_p+M_s); drives the barycentre split. */
  readonly q: number;
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

  constructor() {
    this.group = new THREE.Group();
    this.group.renderOrder = PATH_RENDER_ORDER;
    this.group.visible = false;
    this.material = new THREE.LineBasicMaterial({
      color: PATH_COLOUR,
      transparent: true,
      opacity: PATH_OPACITY,
      depthTest: true,
      depthWrite: false,
    });
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
      const pBase = r.primaryIdx * 3;
      if (pBase + 2 >= absolutePositions.length || r.secondaryIdx * 3 + 2 >= absolutePositions.length) {
        continue;
      }
      const { primary, secondary } = buildBinaryOrbitRingPoints(
        params.elements,
        params.tier,
        { x: absolutePositions[pBase], y: absolutePositions[pBase + 1], z: absolutePositions[pBase + 2] },
        PATH_SEGMENTS,
      );
      const g = new THREE.Group();
      const primaryLoop = this.makeLoop(primary);
      const secondaryLoop = this.makeLoop(secondary);
      g.add(primaryLoop);
      g.add(secondaryLoop);
      this.group.add(g);
      this.pairs.push({
        primaryIdx: r.primaryIdx,
        secondaryIdx: r.secondaryIdx,
        q: params.elements.q,
        group: g,
        primaryLoop,
        secondaryLoop,
      });
    }
    this.group.visible = this.permitted && this.pairs.length > 0;
  }

  private makeLoop(points: Float32Array): THREE.LineLoop {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(points, 3));
    const loop = new THREE.LineLoop(geom, this.material);
    // A sub-AU loop with the camera potentially inside it culls unreliably;
    // let the GPU clip per-vertex.
    loop.frustumCulled = false;
    loop.renderOrder = this.group.renderOrder;
    return loop;
  }

  /**
   * Per-frame barycentre reposition from the freshly-walked local
   * positions. Must run AFTER `BinaryOrbitField.update()` writes this
   * frame's slots, so each ellipse rides its pair's live drift and the
   * two members sit on their own paths.
   */
  update(localPositions: Float32Array): void {
    if (!this.permitted || this.pairs.length === 0) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    for (const p of this.pairs) {
      const pB = p.primaryIdx * 3;
      const sB = p.secondaryIdx * 3;
      const primaryFrac = 1 - p.q;
      p.group.position.set(
        primaryFrac * localPositions[pB] + p.q * localPositions[sB],
        primaryFrac * localPositions[pB + 1] + p.q * localPositions[sB + 1],
        primaryFrac * localPositions[pB + 2] + p.q * localPositions[sB + 2],
      );
    }
  }

  setPermitted(on: boolean): void {
    this.permitted = on;
    if (!on) this.group.visible = false;
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
