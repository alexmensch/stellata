// The star layer on a WebGPU boot: packed geometry + the D2 glow mesh,
// added to the seam's scene. Constructed through WebGpuSeam.attachStarLayer.

import * as THREE from 'three';
import { makeColorLutTexture } from '../../star-pipeline/blackbody-lut';
import { repackScalarInPlace } from '../attribute-packing-pure';
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

  private readonly scene: THREE.Scene;
  private readonly build: StarGeometryBuild;
  private readonly dynArrays: Float32Array[];
  private readonly watchers: DynamicWatcher[];
  private readonly lut: THREE.DataTexture;
  private readonly material: ReturnType<typeof buildStarGlowMaterial>;

  constructor(scene: THREE.Scene, nodes: SharedUniformNodes, sources: StarGeometrySources) {
    this.scene = scene;
    this.build = buildStarGeometry(sources);
    this.dynArrays = this.build.dynAttrs.map((a) => a.array as Float32Array);
    const sourceAttrs = dynamicScalarSourceAttrs(sources);
    this.watchers = STAR_DYNAMIC_SCALARS.map((name) => ({
      name, src: sourceAttrs[name], last: -1,
    }));
    this.lut = makeColorLutTexture();
    this.material = buildStarGlowMaterial({
      u: nodes,
      staticPlan: this.build.staticPlan,
      dynamicPlan: this.build.dynamicPlan,
      lut: this.lut,
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
   *  by object identity. */
  private syncDynamicAttributes(): void {
    let dirty = 0;
    for (const w of this.watchers) {
      if (w.src.version === w.last) continue;
      w.last = w.src.version;
      dirty |= 1 << repackScalarInPlace(
        this.build.dynamicPlan, this.dynArrays, w.name, w.src.array);
    }
    for (let i = 0; dirty !== 0; i++, dirty >>>= 1) {
      if (dirty & 1) this.build.dynAttrs[i].needsUpdate = true;
    }
  }

  dispose(): void {
    this.scene.remove(this.glowMesh);
    this.build.geometry.dispose();
    this.material.dispose();
    this.lut.dispose();
    for (const w of this.watchers) w.last = -1;
  }
}
