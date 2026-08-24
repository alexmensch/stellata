// The D4 disc pipeline in TSL: one draw, per-channel max blend, no depth
// output of any kind — the core-mask draw stamps the depth this one
// reads. README.md § The disc draw writes no depth.

import { Discard, Fn } from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import { applyDiscBlendDefaults } from '../../star-pipeline/star-pipeline';
import { STAR_PASS_DISC } from '../../star-pipeline/star-pass';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import {
  discPassKernel, finishStarColourMaterial, type StarColourMaterial,
} from './star-emission-tsl';
import {
  buildStarVaryings, buildStarVertexNode, type StarTslDeps,
} from './star-vertex-tsl';

export function buildStarDiscMaterial(
  deps: StarTslDeps,
  gates: EmitterGateNodes,
  localMirror = false,
): StarColourMaterial {
  const v = buildStarVaryings();

  const kernel = Fn(() => {
    const glow = discPassKernel(deps.u, v);
    Discard(glow.lessThan(deps.u.uDiscardThreshold));
    return glow;
  });

  const material = new NodeMaterial();
  material.name = localMirror ? 'star-disc-local-tsl' : 'star-disc-tsl';
  material.vertexNode = buildStarVertexNode(deps, STAR_PASS_DISC, v, localMirror);
  material.transparent = true;
  applyDiscBlendDefaults(material);
  // Overrides the helper's depthWrite. The core mask stamped every core
  // at renderOrder −4, so a second write here would be the same value,
  // and a halo must not write at all — which is the whole reason the
  // GLSL build needed gl_FragDepth here (README.md).
  material.depthWrite = false;
  return finishStarColourMaterial(material, deps.u, v, gates, kernel);
}
