// Local-depth-pass mirror draw for cluster-member stars: small
// instanced slots re-copied from the main star geometry each frame.
// See src/client/local-depth/README.md § Full membership.

import * as THREE from 'three';
import { applyDiscBlendDefaults, applyGlowBlendDefaults } from '../star-pipeline';

export const MIRROR_CAPACITY = 8;

interface MirrorAttr {
  src: THREE.InstancedBufferAttribute;
  dst: THREE.InstancedBufferAttribute;
}

export class StarLocalMirror {
  readonly group: THREE.Group;

  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly maskMaterial: THREE.RawShaderMaterial;
  private readonly discMaterial: THREE.RawShaderMaterial;
  private readonly glowMaterial: THREE.RawShaderMaterial;
  private readonly attrs: MirrorAttr[] = [];
  private readonly sourceIdx: Float32Array;
  private members: readonly number[] = [];

  /** `source` is the main star pipeline's instanced geometry — every
   *  per-instance attribute it carries is mirrored by name, so a new
   *  star attribute needs no edit here. Materials share `sharedUniforms`
   *  by reference (single-write propagation, like the main passes). */
  constructor(
    source: THREE.InstancedBufferGeometry,
    vertexShader: string,
    fragmentShader: string,
    sharedUniforms: Record<string, THREE.IUniform>,
  ) {
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

    const makeMat = (mode: number, params: THREE.ShaderMaterialParameters) => {
      const m = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: { ...sharedUniforms, uRenderMode: { value: mode } },
        defines: { LOCAL_DEPTH_PASS: '' },
        vertexShader,
        fragmentShader,
        ...params,
      });
      return m;
    };
    this.maskMaterial = makeMat(2, {
      depthWrite: true,
      depthTest: true,
      colorWrite: false,
    });
    this.discMaterial = makeMat(1, { transparent: true });
    applyDiscBlendDefaults(this.discMaterial);
    this.glowMaterial = makeMat(0, {});
    applyGlowBlendDefaults(this.glowMaterial);

    this.group = new THREE.Group();
    this.group.name = 'star-local-mirror';
    // Depth-only core prepass: stamps every member core's bracket depth
    // before the disc mirror draws, so an occluded core depth-fails
    // instead of reaching the blender — the disc pass's MaxEquation
    // cannot paint OVER an already-painted farther core, it can only be
    // kept from painting at all.
    const maskMesh = new THREE.Mesh(this.geometry, this.maskMaterial);
    maskMesh.frustumCulled = false;
    maskMesh.renderOrder = -1;
    const discMesh = new THREE.Mesh(this.geometry, this.discMaterial);
    discMesh.frustumCulled = false;
    discMesh.renderOrder = 0;
    const glowMesh = new THREE.Mesh(this.geometry, this.glowMaterial);
    glowMesh.frustumCulled = false;
    // After every body surface (mesh 2.8, rings 2.81, shell 2.82): the
    // glow writes no depth, so drawn EARLIER an opaque mesh would erase
    // it wholesale instead of it depth-failing per fragment. Planet
    // glare (4) still adds over everything.
    glowMesh.renderOrder = 3.5;
    this.group.add(maskMesh);
    this.group.add(discMesh);
    this.group.add(glowMesh);
  }

  setMembers(members: readonly number[]): void {
    this.members = members.slice(0, MIRROR_CAPACITY);
  }

  /** Per-frame: re-copy every member's attribute slots from the live
   *  source arrays (positions move with the orbit walk / recentre;
   *  eclipse fields rewrite per frame). ~20 floats per member. */
  sync(): void {
    const n = this.members.length;
    this.geometry.instanceCount = n;
    this.group.visible = n > 0;
    if (n === 0) return;
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
    this.discMaterial.dispose();
    this.glowMaterial.dispose();
  }
}
