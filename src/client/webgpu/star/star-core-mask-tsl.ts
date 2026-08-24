// The D3 core depth-mask in TSL: depth-only over disc-pass cores, colour
// writes off, member stamp in the shared vertex stage — no fragment
// depth (../README.md § Early-z). The CPU visible gate is the shell's.

import { Discard, Fn, vec4 } from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import { STAR_PASS_CORE_MASK } from '../../star-pipeline/star-pass';
import { discPassKernel } from './star-emission-tsl';
import {
  buildStarVaryings, buildStarVertexNode, type StarTslDeps,
} from './star-vertex-tsl';

export function buildStarCoreMaskMaterial(
  deps: StarTslDeps,
  localMirror = false,
): NodeMaterial {
  const v = buildStarVaryings();

  const fragmentNode = Fn(() => {
    // This draw is the ONLY depth a disc core gets, so the gate has to
    // stay the disc draw's own — hence the shared helper rather than a
    // second copy of the three tests (star-emission-tsl.ts).
    Discard(discPassKernel(deps.u, v).lessThan(deps.u.uCoreThreshold));
    return vec4(0.0);
  });

  const material = new NodeMaterial();
  material.name = localMirror ? 'star-core-mask-local-tsl' : 'star-core-mask-tsl';
  material.vertexNode = buildStarVertexNode(deps, STAR_PASS_CORE_MASK, v, localMirror);
  material.fragmentNode = fragmentNode();
  material.colorWrite = false;
  material.depthWrite = true;
  material.depthTest = true;
  return material;
}
