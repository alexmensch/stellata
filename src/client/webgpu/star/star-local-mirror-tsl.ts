// The TSL twin of star-local-mirror.ts: LOCAL_DEPTH_PASS variants of the
// three star pipelines over the shared slot geometry.
// See ../../star-pipeline/local-pass/README.md § Mirror draw.

import type * as THREE from 'three';
import {
  MirrorSlots, type StarMirror,
} from '../../star-pipeline/local-pass/star-mirror-slots';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import type { MrtOutputLayer } from '../hdr/hdr-pipeline-webgpu';
import type { MrtEmitterMaterial } from '../hdr/mrt-material';
import { buildStarCoreMaskMaterial } from './star-core-mask-tsl';
import { buildStarDiscMaterial } from './star-disc-tsl';
import { buildStarGlowMaterial } from './star-glow-tsl';
import type { StarTslDeps, StarVertexSource } from './star-vertex-tsl';

const MIRROR_SOURCE: StarVertexSource = { kind: 'mirror' };

export class StarLocalMirrorTsl implements StarMirror, MrtOutputLayer {
  readonly group: THREE.Group;

  private readonly slots: MirrorSlots;
  /** Mask, disc, glow — every draw into the HDR target takes the swap. */
  private readonly targetMaterials: MrtEmitterMaterial[];

  /** `source` lends its corner + index buffers; it carries no per-instance
   *  attribute, so the slots hold `iSourceIdx` alone and every star field
   *  is read out of the layer's tables by that index. */
  constructor(
    source: THREE.InstancedBufferGeometry,
    deps: StarTslDeps,
    gates: EmitterGateNodes,
  ) {
    this.slots = new MirrorSlots(source);

    const mask = buildStarCoreMaskMaterial(deps, MIRROR_SOURCE);
    const disc = buildStarDiscMaterial(deps, gates, MIRROR_SOURCE);
    const glow = buildStarGlowMaterial(deps, gates, MIRROR_SOURCE);
    this.targetMaterials = [mask, disc, glow];

    this.group = this.slots.buildGroup(
      { mask: mask.material, disc: disc.material, glow: glow.material }, 'webgpu').group;
  }

  /** Driven by the owning StarLayer in lockstep with the main-pass
   *  materials — the mirror's draws land in the same HDR target. */
  setMrtOutputs(on: boolean): void {
    for (const m of this.targetMaterials) m.setMrtOutputs(on);
  }

  setMembers(members: readonly number[]): void {
    this.slots.setMembers(members);
  }

  sync(): void {
    this.group.visible = this.slots.sync();
  }

  dispose(): void {
    this.slots.dispose();
    for (const m of this.targetMaterials) m.material.dispose();
  }
}
