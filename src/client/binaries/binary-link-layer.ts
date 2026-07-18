// Focus-gated connector lines between bound members of the focused
// multi-star system. See src/client/binaries/README.md § Binary link layer.

import * as THREE from 'three';

const BINARY_LINK_COLOUR = 0x9fc2d6;
const BINARY_LINK_OPACITY = 0.55;
// Below the star discs (renderOrder 0) so a disc composites over the line
// where it meets each member; above the galactic disc / grid (−1).
// Constellation figures are SVG, always above the WebGL canvas — a WebGL
// line cannot be drawn over them.
const BINARY_LINK_RENDER_ORDER = -0.5;

/**
 * A single `LineSegments` linking the primary↔secondary of every relation
 * on the focused star's slot-chain. Mirrors `OrbitRingsLayer`: an
 * event-driven rebuild (`setPairs` on focus change) plus a per-frame
 * endpoint refresh from the walked local positions.
 */
export class BinaryLinkLayer {
  readonly group: THREE.Group;
  private material: THREE.LineBasicMaterial;
  private geometry: THREE.BufferGeometry | null = null;
  private lineSegments: THREE.LineSegments | null = null;
  private positions: Float32Array | null = null;
  private pairs: Array<[number, number]> = [];
  // Detail-cycle permission (floor 'representational'); false hides the
  // links even while a system is focused.
  private permitted = true;

  constructor() {
    this.group = new THREE.Group();
    this.group.renderOrder = BINARY_LINK_RENDER_ORDER;
    this.group.visible = false;
    this.material = new THREE.LineBasicMaterial({
      color: BINARY_LINK_COLOUR,
      transparent: true,
      opacity: BINARY_LINK_OPACITY,
      depthTest: true,
      depthWrite: false,
    });
  }

  /**
   * Replace the linked pairs (the focused system's slot-chain). Endpoints
   * are catalog record indices into the per-frame local-position buffer.
   * Rebuilds geometry — call on focus change, not per frame.
   */
  setPairs(pairs: ReadonlyArray<readonly [number, number]>): void {
    this.disposeGeometry();
    this.pairs = pairs.map((p) => [p[0], p[1]]);
    if (this.pairs.length === 0) {
      this.group.visible = false;
      return;
    }
    this.positions = new Float32Array(this.pairs.length * 6);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.lineSegments = new THREE.LineSegments(this.geometry, this.material);
    // Endpoints ride the two stars; the camera can sit between them, so
    // per-vertex clipping is more reliable than frustum-culling the pair.
    this.lineSegments.frustumCulled = false;
    this.lineSegments.renderOrder = this.group.renderOrder;
    this.group.add(this.lineSegments);
    this.group.visible = this.permitted;
  }

  /**
   * Per-frame endpoint refresh from the freshly-walked local positions.
   * Must run AFTER `BinaryOrbitField.update()` writes this frame's slots,
   * so the links track the live orbital positions of a focused pair.
   */
  update(localPositions: Float32Array): void {
    if (!this.permitted || this.positions === null || this.geometry === null) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const pos = this.positions;
    for (let i = 0; i < this.pairs.length; i++) {
      const a = this.pairs[i][0] * 3;
      const b = this.pairs[i][1] * 3;
      const o = i * 6;
      pos[o + 0] = localPositions[a + 0];
      pos[o + 1] = localPositions[a + 1];
      pos[o + 2] = localPositions[a + 2];
      pos[o + 3] = localPositions[b + 0];
      pos[o + 4] = localPositions[b + 1];
      pos[o + 5] = localPositions[b + 2];
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  setPermitted(on: boolean): void {
    this.permitted = on;
    if (!on) this.group.visible = false;
  }

  dispose(): void {
    this.disposeGeometry();
    this.material.dispose();
  }

  private disposeGeometry(): void {
    if (this.lineSegments) this.group.remove(this.lineSegments);
    this.geometry?.dispose();
    this.geometry = null;
    this.lineSegments = null;
    this.positions = null;
  }
}
