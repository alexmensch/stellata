// The IAU boundary arcs as chart-mode line segments on a Sol-centred sphere.
// See README.md § Chart-mode layer.

import * as THREE from 'three';
import type {
  BoundaryArtifact,
  BoundaryFadeTableWire,
} from '../../../scripts/catalog/boundaries/boundaries-artifact-pure';
import { CHART_REFERENCE_INK } from '../chart-mode/chart-palette';
import { SPHERE_RADIUS_PC } from '../galactic/galactic-grid';
import { setBuiltinChromeColour } from '../hdr/chrome-colour';
import { makeOrbitLineMaterial, makeOrbitLineSegments } from '../util/orbit-line';
import {
  boundaryFadeFactor,
  boundarySegmentVertices,
  resolveBoundaryFadeWindowPc,
  type BoundaryFadeWindow,
} from './boundary-layer-pure';

// Under the constellation figure (−0.75) and over the galactic disc / grid
// (−1): the asterism network is the chart's content and the partition is
// reference geometry beneath it.
const BOUNDARY_RENDER_ORDER = -0.8;

// Half the weight of the opaque coordinate sphere sharing the same ink, so
// the two reference layers stay distinguishable with both drawn.
const BOUNDARY_OPACITY = 0.5;

/**
 * The Delporte boundary arcs drawn Sol-centred at `SPHERE_RADIUS_PC`, faded
 * out by camera distance from Sol.
 *
 * **Sol-centred, not camera-tracked** — the deliberate difference from the
 * galactic coordinate sphere, which does track the camera. The partition is a
 * Sol-frame construct: pinning it to Sol is what keeps a star assigned to
 * Orion drawn inside Orion's cell. The group rebases to `−worldOffset` each
 * frame so its absolute-space vertices project into the renderer's local
 * frame, exactly like `galactic/galactic-disc.ts`.
 *
 * Which also means the drawing is only true near Sol, so the fade window is
 * derived from the artifact's quantile table against the live magnitude limit
 * rather than picked — it lands sub-parsec to a few parsecs, and the arcs
 * self-hide before the camera reaches the first star.
 */
export class ConstellationBoundaryLayer {
  readonly group: THREE.Group;
  private readonly material: THREE.LineBasicMaterial;
  private lineSegments: THREE.LineSegments | null = null;
  private fade: BoundaryFadeTableWire | null = null;
  private fadeWindow: BoundaryFadeWindow | null = null;
  // NaN so the first setMagnitudeLimit always misses and recomputes.
  private magLimit = NaN;

  constructor() {
    this.group = new THREE.Group();
    this.group.renderOrder = BOUNDARY_RENDER_ORDER;
    this.group.visible = false;
    this.material = makeOrbitLineMaterial(CHART_REFERENCE_INK, BOUNDARY_OPACITY);
    // The chart starfield renders depth-disabled, so the arcs read flat over
    // it — the same treatment the figure takes in chart mode.
    this.material.depthTest = false;
  }

  /** Build the arc geometry and seed the fade window from the live magnitude
   *  limit. Called once, when the artifact resolves. */
  attach(artifact: BoundaryArtifact, maxAppMag: number): void {
    this.disposeGeometry();
    this.fade = artifact.fade;
    const seg = makeOrbitLineSegments(
      boundarySegmentVertices(artifact.segments, SPHERE_RADIUS_PC),
      this.material,
      BOUNDARY_RENDER_ORDER,
    );
    this.group.add(seg);
    this.lineSegments = seg;
    this.setMagnitudeLimit(maxAppMag);
  }

  /** Re-derive the fade window for a new apparent-magnitude limit. Pushed on
   *  the filter event: a fainter limit admits stars nearer their walls, which
   *  widens the offset at which the drawing stops being true.
   *
   *  The no-table guard has to precede the sentinel, not follow it: filter
   *  pushes land while the artifact is still in flight, and recording the
   *  limit without a table to resolve it against would make `attach`'s own
   *  seeding call look like a no-op and leave the layer with no window. */
  setMagnitudeLimit(maxAppMag: number): void {
    if (this.fade === null || maxAppMag === this.magLimit) return;
    this.magLimit = maxAppMag;
    this.fadeWindow = resolveBoundaryFadeWindowPc(this.fade, maxAppMag);
  }

  /** Per-frame update. The caller ANDs the declutter permission and the
   *  `showConstellation` toggle into its warp gate before calling. */
  update(worldOffset: THREE.Vector3, distFromSolPc: number): void {
    if (this.lineSegments === null || this.fadeWindow === null) {
      this.group.visible = false;
      return;
    }
    const opacity = BOUNDARY_OPACITY * boundaryFadeFactor(distFromSolPc, this.fadeWindow);
    if (opacity <= 0) {
      this.group.visible = false;
      return;
    }
    this.group.position.copy(worldOffset).negate();
    this.material.opacity = opacity;
    this.group.visible = true;
  }

  /** The layer only ever draws in chart mode, so the ink never changes — what
   *  differs is the binding, and both bindings are written so the colour stays
   *  correct if the layer ever gains a realistic floor. Chart mode bypasses
   *  the HDR resolve, so the chart variant must skip the inverse tone-map or
   *  the ink lands at the wrong value on paper (`../hdr/README.md` § Chrome). */
  setMonochrome(on: boolean): void {
    setBuiltinChromeColour(this.material.color, CHART_REFERENCE_INK, on);
  }

  dispose(): void {
    this.disposeGeometry();
    this.material.dispose();
    this.fade = null;
    this.fadeWindow = null;
    this.magLimit = NaN;
  }

  private disposeGeometry(): void {
    if (this.lineSegments === null) return;
    this.group.remove(this.lineSegments);
    this.lineSegments.geometry.dispose();
    this.lineSegments = null;
  }
}
