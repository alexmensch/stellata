// The D2 glow pipeline in TSL: the shared vertex stage plus the glow-pass
// fragment, compile-time specialized (no uRenderMode), no depth output.
// Scope and the deferred siblings: README.md.

import { Discard, Fn, float, smoothstep } from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import { PHYS_RATIO_THRESHOLD } from '../../star-pipeline/local-pass/star-local-cluster-pure';
import { applyGlowBlendDefaults } from '../../star-pipeline/star-pipeline';
import { STAR_PASS_GLOW } from '../../star-pipeline/star-pass';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import {
  discardOutsideKernel, finishStarColourMaterial, starGlowNode,
  type StarColourMaterial,
} from './star-emission-tsl';
import {
  buildStarVaryings, buildStarVertexNode, type StarTslDeps,
} from './star-vertex-tsl';

export function buildStarGlowMaterial(
  deps: StarTslDeps,
  gates: EmitterGateNodes,
): StarColourMaterial {
  const v = buildStarVaryings();

  const kernel = Fn(() => {
    discardOutsideKernel(v);
    Discard(v.vPhysRatio.greaterThanEqual(PHYS_RATIO_THRESHOLD));

    const glow = starGlowNode(deps.u, v).toVar();
    const taper = float(1.0)
      .sub(smoothstep(deps.u.uThresholdMag, deps.u.uThresholdMag.add(0.5), v.vAppMag));
    glow.mulAssign(taper);
    return glow;
  });

  const material = new NodeMaterial();
  material.name = 'star-glow-tsl';
  material.vertexNode = buildStarVertexNode(deps, STAR_PASS_GLOW, v);
  applyGlowBlendDefaults(material);
  return finishStarColourMaterial(material, deps.u, v, gates, kernel);
}
