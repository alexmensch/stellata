// The D4 disc pipeline in TSL: one draw, per-channel max blend, no depth
// output of any kind — the core-mask draw stamps the depth this one
// reads. README.md § The disc draw writes no depth.

import { Discard, Fn, step } from 'three/tsl';
import { NodeMaterial, type Node } from 'three/webgpu';
import type * as THREE from 'three';
import { applyDiscBlendDefaults } from '../../star-pipeline/star-pipeline';
import { STAR_PASS_DISC } from '../../star-pipeline/star-pass';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import {
  discPassEntryGate, discPassKernel, finishStarColourMaterial,
  type StarColourMaterial,
} from './star-emission-tsl';
import {
  buildStarVaryings, buildStarVertexNode, type StarTslDeps,
} from './star-vertex-tsl';

/** The disc draw's calibrated blend state — construction AND chart-mode
 *  swap-back both go through here, exactly as the GLSL pipeline's two
 *  sites share `applyDiscBlendDefaults`. The `depthWrite` override is what
 *  makes it more than that helper: the core mask stamped every core at
 *  renderOrder −4, so a second write here would be the same value, and a
 *  halo must not write at all — which is the whole reason the GLSL build
 *  needed `gl_FragDepth` in this pass (README.md § The disc draw writes no
 *  depth). Losing it on swap-back would put the halo's depth back. */
export function applyStarDiscTslBlend(m: THREE.Material) {
  applyDiscBlendDefaults(m);
  m.transparent = true;
  m.depthWrite = false;
}

export function buildStarDiscMaterial(
  deps: StarTslDeps,
  gates: EmitterGateNodes,
  localMirror = false,
): StarColourMaterial {
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
  material.name = localMirror ? 'star-disc-local-tsl' : 'star-disc-tsl';
  material.vertexNode = buildStarVertexNode(deps, STAR_PASS_DISC, v, localMirror);
  applyStarDiscTslBlend(material);
  return finishStarColourMaterial(
    material, deps.u, v, gates, () => discPassEntryGate(v), kernel, coreMask);
}
