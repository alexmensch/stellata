// The backend-neutral half of a star local mirror: the slot geometry over
// the main star geometry, its per-frame copy, and the three in-pass draws.
// See README.md § Mirror draw.

import * as THREE from 'three';

export const MIRROR_CAPACITY = 8;

/** In-pass draw order. The depth-only core prepass stamps every member
 *  core's bracket depth before the disc draw, so an occluded core
 *  depth-fails instead of reaching the blender — the disc pass's
 *  MaxEquation cannot paint OVER an already-painted farther core, it can
 *  only be kept from painting at all. Glow comes after every body surface
 *  (mesh 2.8, rings 2.81, shell 2.82): it writes no depth, so drawn
 *  EARLIER an opaque mesh would erase it wholesale instead of it
 *  depth-failing per fragment. Planet glare (4) still adds over everything. */
export const MIRROR_RENDER_ORDER = { mask: -1, disc: 0, glow: 3.5 } as const;

/** What StarLocalCluster drives, whichever backend built the mirror —
 *  `star-local-mirror.ts` (GLSL) or
 *  `../../webgpu/star/star-local-mirror-tsl.ts` (TSL). */
export interface StarMirror {
  readonly group: THREE.Group;
  setMembers(members: readonly number[]): void;
  sync(): void;
  dispose(): void;
}

/** The three materials one mirror draws its slots with, in pass order. */
export interface MirrorMaterials {
  mask: THREE.Material;
  disc: THREE.Material;
  glow: THREE.Material;
}

interface MirrorAttr {
  src: THREE.InstancedBufferAttribute;
  dst: THREE.InstancedBufferAttribute;
}

/**
 * A MIRROR_CAPACITY-slot copy of the star geometry, re-filled from the
 * live source arrays each frame. Both backends share it: the slot layout
 * is a property of the geometry being mirrored, not of the shader
 * language, and a copy that resolved a differently-named or
 * differently-packed component on one backend would read as a silent
 * brightness bug.
 */
export class MirrorSlots {
  readonly geometry: THREE.InstancedBufferGeometry;

  private readonly attrs: MirrorAttr[] = [];
  private readonly sourceIdx: Float32Array;
  private members: readonly number[] = [];

  /** `source` is the geometry being mirrored — every per-instance
   *  attribute it carries is mirrored BY NAME, so a new star attribute
   *  needs no edit here and a packed component resolves to the same slot
   *  on both geometries by construction. */
  constructor(source: THREE.InstancedBufferGeometry) {
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
  }

  /** The group and its three meshes, over one shared slot geometry.
   *  `label` names the meshes for the debugger and nothing else. */
  buildGroup(materials: MirrorMaterials, label: string): {
    group: THREE.Group;
    maskMesh: THREE.Mesh;
    discMesh: THREE.Mesh;
    glowMesh: THREE.Mesh;
  } {
    const group = new THREE.Group();
    group.name = 'star-local-mirror';
    const mesh = (material: THREE.Material, name: string, renderOrder: number) => {
      const m = new THREE.Mesh(this.geometry, material);
      m.name = name;
      m.frustumCulled = false;
      m.renderOrder = renderOrder;
      group.add(m);
      return m;
    };
    return {
      group,
      maskMesh: mesh(materials.mask, `star-core-mask-local-${label}`, MIRROR_RENDER_ORDER.mask),
      discMesh: mesh(materials.disc, `star-disc-local-${label}`, MIRROR_RENDER_ORDER.disc),
      glowMesh: mesh(materials.glow, `star-glow-local-${label}`, MIRROR_RENDER_ORDER.glow),
    };
  }

  setMembers(members: readonly number[]): void {
    this.members = members.slice(0, MIRROR_CAPACITY);
  }

  /** Per-frame: re-copy every member's attribute slots from the live
   *  source arrays (positions move with the orbit walk / recentre;
   *  eclipse fields rewrite per frame). ~30 floats per member. Returns
   *  whether any member draws — the mirror group's `visible`.
   *
   *  `beforeCopy` runs only when there IS something to copy, and before
   *  the first read: the TSL mirror copies PACKED values, so the packed
   *  buffers have to be current-frame first. */
  sync(beforeCopy?: () => void): boolean {
    const n = this.members.length;
    this.geometry.instanceCount = n;
    if (n === 0) return false;
    beforeCopy?.();
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
    return true;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
