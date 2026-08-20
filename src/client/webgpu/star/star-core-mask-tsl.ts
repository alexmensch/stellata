// The D3 core depth-mask in TSL: depth-only over disc-pass cores, colour
// writes off. The member stamp lives in the shared vertex stage (near
// pin), so no pipeline here writes fragment depth (../README.md
// § Early-z). The CPU-side visible gate stays with the integration shell.

import { Discard, Fn, length, vec4 } from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import { PHYS_RATIO_THRESHOLD } from '../../star-pipeline/local-pass/star-local-cluster-pure';
import { STAR_PASS_CORE_MASK } from '../../star-pipeline/star-pass';
import { starGlowNode } from './star-emission-tsl';
import {
  buildStarVaryings, buildStarVertexNode, type StarTslDeps,
} from './star-vertex-tsl';

export function buildStarCoreMaskMaterial(deps: StarTslDeps): NodeMaterial {
  const v = buildStarVaryings();

  const fragmentNode = Fn(() => {
    Discard(length(v.vUv).greaterThan(0.5));
    // The disc pass's own gates, so no depth is stamped for a star that
    // would not render colour.
    Discard(v.vPhysRatio.lessThan(PHYS_RATIO_THRESHOLD));
    Discard(v.vAppMag.greaterThan(deps.u.uThresholdMag));
    Discard(starGlowNode(deps.u, v).lessThan(deps.u.uCoreThreshold));
    return vec4(0.0);
  });

  const material = new NodeMaterial();
  material.name = 'star-core-mask-tsl';
  material.vertexNode = buildStarVertexNode(deps, STAR_PASS_CORE_MASK, v);
  material.fragmentNode = fragmentNode();
  material.colorWrite = false;
  material.depthWrite = true;
  material.depthTest = true;
  return material;
}
