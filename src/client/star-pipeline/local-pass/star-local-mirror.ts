// Local-depth-pass mirror draw for cluster-member stars: the GLSL half of
// the StarMirror contract over the shared slot geometry.
// See src/client/local-depth/README.md § Full membership.

import * as THREE from 'three';
import { applyDiscBlendDefaults, applyGlowBlendDefaults } from '../star-pipeline';
import { markStatisticEmitter } from '../../hdr/attachments/attachment-gate';
import {
  STAR_PASS_CORE_MASK, STAR_PASS_DISC, STAR_PASS_GLOW, type StarPass,
} from '../star-pass';
import { MirrorSlots, type StarMirror } from './star-mirror-slots';

export class StarLocalMirror implements StarMirror {
  readonly group: THREE.Group;

  private readonly slots: MirrorSlots;
  private readonly materials: THREE.RawShaderMaterial[];

  /** `source` is the main star pipeline's instanced geometry. Materials
   *  share `sharedUniforms` by reference (single-write propagation, like
   *  the main passes). */
  constructor(
    source: THREE.InstancedBufferGeometry,
    vertexShader: string,
    fragmentShader: string,
    sharedUniforms: Record<string, THREE.IUniform>,
  ) {
    this.slots = new MirrorSlots(source);

    const makeMat = (pass: StarPass, params: THREE.ShaderMaterialParameters) =>
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: { ...sharedUniforms, uRenderMode: { value: pass } },
        defines: { LOCAL_DEPTH_PASS: '' },
        vertexShader,
        fragmentShader,
        ...params,
      });
    const mask = makeMat(STAR_PASS_CORE_MASK, {
      depthWrite: true,
      depthTest: true,
      colorWrite: false,
    });
    const disc = makeMat(STAR_PASS_DISC, { transparent: true });
    applyDiscBlendDefaults(disc);
    const glow = makeMat(STAR_PASS_GLOW, {});
    applyGlowBlendDefaults(glow);
    this.materials = [mask, disc, glow];

    const built = this.slots.buildGroup({ mask, disc, glow }, 'webgl');
    this.group = built.group;
    markStatisticEmitter(built.discMesh);
    markStatisticEmitter(built.glowMesh);
  }

  setMembers(members: readonly number[]): void {
    this.slots.setMembers(members);
  }

  sync(): void {
    this.group.visible = this.slots.sync();
  }

  dispose(): void {
    this.slots.dispose();
    for (const m of this.materials) m.dispose();
  }
}
