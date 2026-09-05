// The D3 core depth-mask in TSL: depth-only over disc-pass cores, colour
// writes off, member stamp in the shared vertex stage — no fragment
// depth (../README.md § Early-z). The CPU visible gate is the shell's.

import { Discard, If, vec4 } from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import { STAR_PASS_CORE_MASK } from '../../star-pipeline/star-pass';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import {
  chartDiscCoverage, discPassEntryGate, discPassKernel,
} from './star-emission-tsl';
import {
  buildStarVaryings, buildStarVertexNode, type StarTslDeps,
} from './star-vertex-tsl';

/**
 * Colour writes are off, so every output this fragment declares is
 * discarded by the write mask — yet it still carries the single↔struct
 * swap. three keys its render-pipeline cache on the shader program ids plus
 * attachment 0's format alone (`WebGPUBackend.getRenderCacheKey`), and
 * builds the pipeline's colour-target list from the bound target. A
 * material whose fragment program is identical under both attachment
 * counts is therefore handed the pipeline built for the OTHER count when
 * the target is rebuilt, and Dawn drops every command buffer it appears in
 * (../hdr/README.md § The gate becomes the output struct).
 */
export function buildStarCoreMaskMaterial(
  deps: StarTslDeps,
  localMirror = false,
): MrtEmitterMaterial {
  const v = buildStarVaryings();

  const material = new NodeMaterial();
  material.name = localMirror ? 'star-core-mask-local-tsl' : 'star-core-mask-tsl';
  material.vertexNode = buildStarVertexNode(deps, STAR_PASS_CORE_MASK, v, localMirror);
  material.colorWrite = false;
  material.depthWrite = true;
  material.depthTest = true;
  return finishMrtMaterial(material, () => {
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
    return { colour: vec4(0.0), statistic: vec4(0.0), diffuse: vec4(0.0) };
  });
}
