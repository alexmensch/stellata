// The D3 core depth-mask in TSL: depth-only over disc-pass cores, colour
// writes off, member stamp in the shared vertex stage — no fragment
// depth (../README.md § Early-z). The CPU visible gate is the shell's.

import { Discard, Fn, If, vec4 } from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import { STAR_PASS_CORE_MASK } from '../../star-pipeline/star-pass';
import {
  chartDiscCoverage, discPassEntryGate, discPassKernel,
} from './star-emission-tsl';
import {
  buildStarVaryings, buildStarVertexNode, type StarTslDeps,
} from './star-vertex-tsl';

export function buildStarCoreMaskMaterial(
  deps: StarTslDeps,
  localMirror = false,
): NodeMaterial {
  const v = buildStarVaryings();

  const fragmentNode = Fn(() => {
    // This draw is the ONLY depth a disc core gets, so its gate has to
    // stay the disc draw's own — hence the shared helpers rather than a
    // second copy of the tests (star-emission-tsl.ts). Chart mode stamps
    // depth over exactly the fragments its disc draw inks, which is a
    // different gate but the same rule.
    discPassEntryGate(v);
    If(deps.u.uMonochrome.greaterThan(0.5), () => {
      chartDiscCoverage(deps.u, v);
    }).Else(() => {
      Discard(discPassKernel(deps.u, v).lessThan(deps.u.uCoreThreshold));
    });
    // Ignored — colour writes are off on this material.
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
