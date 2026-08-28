// The two stroke parts neither backend varies: the fat line's object
// assembly and the plain blend flip. See README.md.

import * as THREE from 'three';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import type { FatChromeLineSpec } from './chrome-line-materials';

/** What both `Line2` classes satisfy. Only the constructor is
 *  backend-specific, which is why `make` is the caller's half. */
export interface FatChromeLineObject extends THREE.Object3D {
  computeLineDistances(): unknown;
}

/** Build the fat stroke's geometry and configure its drawable. The class
 *  differs per backend (README.md § The fat stroke brings its own object)
 *  but everything around it does not, and `computeLineDistances` is
 *  load-bearing for the dashed case rather than incidental. */
export function assembleFatChromeLine<T extends FatChromeLineObject>(
  spec: FatChromeLineSpec,
  make: (geometry: LineGeometry) => T,
): T {
  const geometry = new LineGeometry();
  geometry.setPositions(spec.points);
  const line = make(geometry);
  line.computeLineDistances();
  line.frustumCulled = false;
  line.renderOrder = spec.renderOrder;
  return line;
}

/** Run a stroke opaque with blending off, or alpha-composited. The fat
 *  stroke's WebGPU material is the one that cannot express it this way —
 *  `../webgpu/chrome-lines/README.md` § The fat stroke keeps three's
 *  fragment. */
export function setStrokeOpaque(material: THREE.Material, on: boolean) {
  material.transparent = !on;
  material.blending = on ? THREE.NoBlending : THREE.NormalBlending;
  material.needsUpdate = true;
}
