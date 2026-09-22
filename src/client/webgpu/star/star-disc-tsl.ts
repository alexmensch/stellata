// The D4 disc pipeline in TSL: one draw, per-channel max blend, no depth
// output of any kind — the core-mask draw stamps the depth this one
// reads. README.md § The disc draw writes no depth.

import { Discard, Fn, step } from 'three/tsl';
import { NodeMaterial, type Node } from 'three/webgpu';
import { applyDiscBlendDefaults } from '../../star-pipeline/star-blend';
import { STAR_PASS_DISC } from '../../star-pipeline/star-pass';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import type { MrtEmitterMaterial } from '../hdr/mrt-material';
import {
  discPassEntryGate, discPassKernel, finishStarColourMaterial,
} from './star-emission-tsl';
import {
  buildStarVaryings, buildStarVertexNode, type StarTslDeps, type StarVertexSource,
} from './star-vertex-tsl';

export function buildStarDiscMaterial(
  deps: StarTslDeps,
  gates: EmitterGateNodes,
  source: StarVertexSource,
): MrtEmitterMaterial {
  const v = buildStarVaryings();

  const kernel = Fn(() => {
    const glow = discPassKernel(deps.u, v);
    // Drop the imperceptible outer fringe entirely so it costs no blend.
    // The mask's own tail test is uCoreThreshold, which is stricter, so
    // its stamped set stays a subset of what this draw inks.
    Discard(glow.lessThan(deps.u.uDiscardThreshold));
    return glow;
  });

  // The core is where the kernel reads as the photosphere rather than as
  // its halo, so it is exactly the fragment set that may claim lit-surface
  // coverage (../../hdr/attachments/README.md § The unit). Same threshold
  // the core mask stamps depth over.
  const coreMask = (glow: Node<'float'>) => step(deps.u.uCoreThreshold, glow);

  const material = new NodeMaterial();
  material.name = source.kind === 'mirror' ? 'star-disc-local-tsl' : 'star-disc-tsl';
  material.vertexNode = buildStarVertexNode(deps, STAR_PASS_DISC, v, source);
  applyDiscBlendDefaults(material);
  return finishStarColourMaterial(
    material, deps.u, v, gates, () => discPassEntryGate(v), kernel, coreMask);
}
