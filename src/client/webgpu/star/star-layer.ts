// The star layer on a WebGPU boot: packed geometry + the D2 glow mesh,
// added to the seam's scene. Constructed through WebGpuSeam.attachStarLayer.

import * as THREE from 'three';
import { makeColorLutTexture } from '../../star-pipeline/blackbody-lut';
import {
  packedUploadRange, repackScalarInPlace, repackScalarRange,
} from '../attribute-packing-pure';
import { STAR_DYNAMIC_SCALARS } from '../star-attribute-roster';
import type { SharedUniformNodes } from '../shared-uniform-nodes';
import {
  buildStarGeometry,
  dynamicScalarSourceAttrs,
  type StarGeometryBuild,
  type StarGeometrySources,
} from './star-geometry';
import { buildStarGlowMaterial } from './star-glow-tsl';

interface DynamicWatcher {
  name: (typeof STAR_DYNAMIC_SCALARS)[number];
  src: THREE.InstancedBufferAttribute;
  /** Sentinel -1: the first rendered frame always re-packs, so a write
   *  landing between construction and first render cannot be missed. */
  last: number;
}

export class StarLayer {
  readonly glowMesh: THREE.Mesh;
  /** Owned by this layer alone — the WebGL pipeline builds its own. */
  readonly colorLut: THREE.DataTexture;

  private readonly scene: THREE.Scene;
  private readonly build: StarGeometryBuild;
  private readonly dynArrays: Float32Array[];
  private readonly watchers: DynamicWatcher[];
  private readonly material: ReturnType<typeof buildStarGlowMaterial>;
  /** Per-frame scratch, one slot per packed dynamic buffer — reused so the
   *  render loop allocates nothing. */
  private readonly pendingFull: boolean[];
  private readonly pendingRanges: { start: number; count: number }[][];

  constructor(scene: THREE.Scene, nodes: SharedUniformNodes, sources: StarGeometrySources) {
    this.scene = scene;
    this.build = buildStarGeometry(sources);
    this.dynArrays = this.build.dynAttrs.map((a) => a.array as Float32Array);
    const sourceAttrs = dynamicScalarSourceAttrs(sources);
    this.watchers = STAR_DYNAMIC_SCALARS.map((name) => ({
      name, src: sourceAttrs[name], last: -1,
    }));
    this.pendingFull = this.build.dynAttrs.map(() => false);
    this.pendingRanges = this.build.dynAttrs.map(() => []);
    this.colorLut = makeColorLutTexture();
    this.material = buildStarGlowMaterial({
      u: nodes,
      staticPlan: this.build.staticPlan,
      dynamicPlan: this.build.dynamicPlan,
      lut: this.colorLut,
    });

    this.glowMesh = new THREE.Mesh(this.build.geometry, this.material);
    this.glowMesh.name = 'star-glow-webgpu';
    this.glowMesh.frustumCulled = false;
    this.glowMesh.renderOrder = 1;
    this.glowMesh.onBeforeRender = () => this.syncDynamicAttributes();
    scene.add(this.glowMesh);
  }

  /** Re-pack any per-frame scalar whose WebGL-side source attribute was
   *  flagged since the last rendered frame. The writers (binary/eclipse
   *  fields, the shell) keep writing the WebGL attributes and never learn
   *  about the port; iPosition needs no watcher — it joins this geometry
   *  by object identity.
   *
   *  A source reporting three.js update ranges is repacked and uploaded
   *  over those slots only; one flagged with a bare `needsUpdate` takes
   *  the whole-buffer pass. Ranges must lose to a full upload on the same
   *  buffer in the same frame — three.js honours a non-empty range list
   *  INSTEAD of the full array, so a range added beside a full pass would
   *  drop every slot outside it. */
  private syncDynamicAttributes(): void {
    const fullPass = this.pendingFull;
    const ranged = this.pendingRanges;
    fullPass.fill(false);
    for (const r of ranged) r.length = 0;

    for (const w of this.watchers) {
      if (w.src.version === w.last) continue;
      w.last = w.src.version;
      const srcRanges = w.src.updateRanges;
      if (srcRanges.length === 0) {
        fullPass[repackScalarInPlace(
          this.build.dynamicPlan, this.dynArrays, w.name, w.src.array)] = true;
        continue;
      }
      const itemSize = w.src.itemSize;
      for (const r of srcRanges) {
        const startItem = r.start / itemSize;
        const itemCount = r.count / itemSize;
        const buffer = repackScalarRange(
          this.build.dynamicPlan, this.dynArrays, w.name, w.src.array, startItem, itemCount);
        ranged[buffer].push(packedUploadRange(startItem, itemCount));
      }
      // Nothing else consumes these: on a WebGPU boot the WebGL geometry
      // never renders, so no renderer clears them and they would
      // accumulate to the uploader's range cap and force a full upload.
      w.src.clearUpdateRanges();
    }

    for (let b = 0; b < this.build.dynAttrs.length; b++) {
      const attr = this.build.dynAttrs[b];
      if (fullPass[b]) {
        attr.clearUpdateRanges();
        attr.needsUpdate = true;
      } else if (ranged[b].length > 0) {
        for (const r of ranged[b]) attr.addUpdateRange(r.start, r.count);
        attr.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.glowMesh);
    this.build.geometry.dispose();
    this.material.dispose();
    this.colorLut.dispose();
    for (const w of this.watchers) w.last = -1;
  }
}
