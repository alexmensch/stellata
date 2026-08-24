// The TSL twin of star-local-mirror.ts: LOCAL_DEPTH_PASS variants of the
// three star pipelines over a MIRROR_CAPACITY-slot copy of the packed
// geometry. See ../../star-pipeline/local-pass/README.md § Mirror draw.

import * as THREE from 'three';
import {
  MIRROR_CAPACITY, type StarMirror,
} from '../../star-pipeline/local-pass/star-local-mirror';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import type { MrtOutputLayer } from '../hdr/hdr-pipeline-webgpu';
import { buildStarCoreMaskMaterial } from './star-core-mask-tsl';
import { buildStarDiscMaterial } from './star-disc-tsl';
import { buildStarGlowMaterial } from './star-glow-tsl';
import type { StarColourMaterial } from './star-emission-tsl';
import type { StarTslDeps } from './star-vertex-tsl';

interface MirrorAttr {
  src: THREE.InstancedBufferAttribute;
  dst: THREE.InstancedBufferAttribute;
}

export class StarLocalMirrorTsl implements StarMirror, MrtOutputLayer {
  readonly group: THREE.Group;

  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly maskMaterial: THREE.Material;
  private readonly colourMaterials: StarColourMaterial[];
  private readonly attrs: MirrorAttr[] = [];
  private readonly sourceIdx: Float32Array;
  private readonly syncSources: () => void;
  private members: readonly number[] = [];

  /** `source` is the layer's packed instanced geometry — every
   *  per-instance attribute (iPosition, iPuls, the iPack/iDyn vec4s) is
   *  mirrored by name, so the packedScalar accessors resolve to the same
   *  component on both geometries by construction. `syncSources` is the
   *  layer's dynamic re-pack: the mirror copies packed values, so the
   *  packed buffers must be current-frame before each sync. */
  constructor(
    source: THREE.InstancedBufferGeometry,
    deps: StarTslDeps,
    gates: EmitterGateNodes,
    syncSources: () => void,
  ) {
    this.syncSources = syncSources;
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('aCorner', source.getAttribute('aCorner'));
    this.geometry.setIndex(source.getIndex());
    for (const [name, attr] of Object.entries(source.attributes)) {
      if (!(attr instanceof THREE.InstancedBufferAttribute)) continue;
      const dst = new THREE.InstancedBufferAttribute(
        new Float32Array(MIRROR_CAPACITY * attr.itemSize),
        attr.itemSize,
      );
      dst.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, dst);
      this.attrs.push({ src: attr, dst });
    }
    this.sourceIdx = new Float32Array(MIRROR_CAPACITY);
    const srcIdxAttr = new THREE.InstancedBufferAttribute(this.sourceIdx, 1);
    srcIdxAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iSourceIdx', srcIdxAttr);
    this.geometry.instanceCount = 0;
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mask = buildStarCoreMaskMaterial(deps, true);
    const disc = buildStarDiscMaterial(deps, gates, true);
    const glow = buildStarGlowMaterial(deps, gates, true);
    this.maskMaterial = mask;
    this.colourMaterials = [disc, glow];

    this.group = new THREE.Group();
    this.group.name = 'star-local-mirror';
    const mesh = (material: THREE.Material, name: string, renderOrder: number) => {
      const m = new THREE.Mesh(this.geometry, material);
      m.name = name;
      m.frustumCulled = false;
      m.renderOrder = renderOrder;
      this.group.add(m);
      return m;
    };
    // In-pass order mirrors the GLSL mirror: the depth-only core prepass
    // (−1) stamps every member core's bracket depth before the disc draw,
    // so an occluded core depth-fails instead of reaching the MaxEquation
    // blender; glow (3.5) after every body surface, before glare (4).
    mesh(mask, 'star-core-mask-local-webgpu', -1);
    mesh(disc.material, 'star-disc-local-webgpu', 0);
    mesh(glow.material, 'star-glow-local-webgpu', 3.5);
  }

  /** Driven by the owning StarLayer in lockstep with the main-pass
   *  materials — the mirror's colour draws land in the same HDR target. */
  setMrtOutputs(on: boolean): void {
    for (const m of this.colourMaterials) m.setMrtOutputs(on);
  }

  setMembers(members: readonly number[]): void {
    this.members = members.slice(0, MIRROR_CAPACITY);
  }

  /** Per-frame: re-pack the dynamic sources, then re-copy every member's
   *  attribute slots from the packed arrays. ~30 floats per member. */
  sync(): void {
    const n = this.members.length;
    this.geometry.instanceCount = n;
    this.group.visible = n > 0;
    if (n === 0) return;
    this.syncSources();
    for (let m = 0; m < n; m++) {
      const idx = this.members[m];
      this.sourceIdx[m] = idx;
      for (const { src, dst } of this.attrs) {
        const k = src.itemSize;
        const srcArr = src.array as Float32Array;
        for (let c = 0; c < k; c++) {
          (dst.array as Float32Array)[m * k + c] = srcArr[idx * k + c];
        }
      }
    }
    for (const { dst } of this.attrs) dst.needsUpdate = true;
    (this.geometry.getAttribute('iSourceIdx') as THREE.InstancedBufferAttribute)
      .needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.maskMaterial.dispose();
    for (const m of this.colourMaterials) m.material.dispose();
  }
}
