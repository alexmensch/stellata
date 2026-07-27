// Constellation stick figures as depth-tested WebGL line segments between
// member stars' local positions. See src/client/constellation-figure/README.md.

import * as THREE from 'three';
import { type Constellation } from '../loaders/catalog-loader';
import { makeOrbitLineMaterial, makeOrbitLineSegments } from '../util/orbit-line';
import { setBuiltinChromeColour } from '../hdr/chrome-colour';
import { collectFigureSegmentEndpoints } from './constellation-figure-pure';

// Above the galactic disc/grid (−1) and Local Bubble shell (−1), below the
// binary orbit paths (−0.5) and star discs (0). depthWrite is off, so — like
// the binary orbit paths — a star disc composites over a line where the two
// coincide, and the renderOrder −4 star/planet core depth-masks make close
// discs occlude the lines through the depth buffer without a screen-space mask.
const FIGURE_RENDER_ORDER = -0.75;

// Chart mode swaps the sky-blue stroke for the ink-on-paper palette and drops
// depth-testing so the figure reads as a flat atlas overlay against the
// depth-disabled chart starfield.
const REALISTIC_COLOUR = 0x7dd3fc;
const CHART_COLOUR = 0x14161e;
const FIGURE_OPACITY = 0.85;

/**
 * The constellation stick figure as a `THREE.LineSegments` group. Geometry is
 * rebuilt on highlight / chart change (`setFigures`); vertex positions re-copy
 * from the live `localPositions` every drawn frame (`update`) so a vertex
 * tracks its star through epoch advance, recentre, and binary orbital motion.
 * Camera motion adds no work: the GPU projects the local-frame vertices exactly
 * as it does the star instances.
 */
export class ConstellationFigureLayer {
  readonly group: THREE.Group;
  private readonly material: THREE.LineBasicMaterial;
  private lineSegments: THREE.LineSegments | null = null;
  private positions: Float32Array | null = null;
  private endpointIdx: number[] = [];
  private permitted = true;

  constructor() {
    this.group = new THREE.Group();
    this.group.renderOrder = FIGURE_RENDER_ORDER;
    this.group.visible = false;
    this.material = makeOrbitLineMaterial(REALISTIC_COLOUR, FIGURE_OPACITY);
  }

  /** Rebuild the line geometry for the active constellation set (one index
   *  when a figure is highlighted, all of them in chart mode, none to clear).
   *  `localPositions` seeds the vertex buffer so no zeroed frame renders
   *  before the first `update`. */
  setFigures(
    constellations: readonly Constellation[],
    conIndices: readonly number[],
    localPositions: Float32Array,
  ): void {
    this.endpointIdx = collectFigureSegmentEndpoints(constellations, conIndices);
    this.disposeGeometry();
    if (this.endpointIdx.length === 0) {
      this.group.visible = false;
      return;
    }
    this.positions = new Float32Array(this.endpointIdx.length * 3);
    this.writePositions(localPositions);
    const seg = makeOrbitLineSegments(this.positions, this.material, FIGURE_RENDER_ORDER);
    this.group.add(seg);
    this.lineSegments = seg;
    this.group.visible = this.permitted;
  }

  /** Re-copy vertex positions from the live local-frame buffer. Runs every
   *  drawn frame: a figure vertex tracks its star through proper-motion epoch
   *  advance, floating-origin recentre, AND binary orbital motion under time
   *  scrub — all of which rewrite `localPositions` with no separate signal.
   *  The buffer is at most a few thousand floats, so the copy + re-upload is
   *  negligible (the `BinaryOrbitPathLayer` repositions per frame the same
   *  way). Skipped while hidden. */
  update(localPositions: Float32Array): void {
    if (this.lineSegments === null || !this.group.visible) return;
    this.writePositions(localPositions);
    this.lineSegments.geometry.attributes.position.needsUpdate = true;
  }

  setPermitted(on: boolean): void {
    this.permitted = on;
    this.group.visible = on && this.lineSegments !== null;
  }

  setMonochrome(on: boolean): void {
    setBuiltinChromeColour(this.material.color, on ? CHART_COLOUR : REALISTIC_COLOUR, on);
    this.material.depthTest = !on;
  }

  dispose(): void {
    this.disposeGeometry();
    this.material.dispose();
  }

  private writePositions(localPositions: Float32Array): void {
    const pos = this.positions!;
    const idx = this.endpointIdx;
    for (let k = 0; k < idx.length; k++) {
      const b = idx[k] * 3;
      const o = k * 3;
      pos[o] = localPositions[b];
      pos[o + 1] = localPositions[b + 1];
      pos[o + 2] = localPositions[b + 2];
    }
  }

  private disposeGeometry(): void {
    if (this.lineSegments === null) return;
    this.group.remove(this.lineSegments);
    this.lineSegments.geometry.dispose();
    this.lineSegments = null;
    this.positions = null;
  }
}
