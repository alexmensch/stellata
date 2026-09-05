// The D2 glow pipeline in TSL: the shared vertex stage plus the glow-pass
// fragment, compile-time specialized (no uRenderMode), no depth output.

import { Discard, Fn, float, smoothstep } from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import { PHYS_RATIO_THRESHOLD } from '../../star-pipeline/local-pass/star-local-cluster-pure';
import { applyGlowBlendDefaults } from '../../star-pipeline/star-pipeline';
import { STAR_PASS_GLOW } from '../../star-pipeline/star-pass';
import { SOFT_TAPER_MARGIN_MAG } from '../../solar-system/perceptual-magnitude';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import type { MrtEmitterMaterial } from '../hdr/mrt-material';
import {
  discardOutsideKernel, finishStarColourMaterial, starGlowNode,
} from './star-emission-tsl';
import {
  buildStarVaryings, buildStarVertexNode, type StarTslDeps,
} from './star-vertex-tsl';

export function buildStarGlowMaterial(
  deps: StarTslDeps,
  gates: EmitterGateNodes,
  localMirror = false,
): MrtEmitterMaterial {
  const v = buildStarVaryings();

  // The disc/glow split is a property of the star, not of the render
  // style, so chart mode shares it — hence outside the chart branch.
  const entryGate = () => {
    discardOutsideKernel(v);
    Discard(v.vPhysRatio.greaterThanEqual(PHYS_RATIO_THRESHOLD));
  };

  const kernel = Fn(() => {
    const glow = starGlowNode(deps.u, v).toVar();
    const taper = float(1.0).sub(smoothstep(
      deps.u.uThresholdMag,
      deps.u.uThresholdMag.add(SOFT_TAPER_MARGIN_MAG),
      v.vAppMag,
    ));
    glow.mulAssign(taper);
    return glow;
  });

  // A PSF peak spread over an exaggerated kernel, never a photosphere's
  // own footprint, so this pass claims no lit-surface coverage at any
  // framing (../../hdr/attachments/README.md § The unit).
  const coreMask = () => float(0.0);

  const material = new NodeMaterial();
  material.name = localMirror ? 'star-glow-local-tsl' : 'star-glow-tsl';
  material.vertexNode = buildStarVertexNode(deps, STAR_PASS_GLOW, v, localMirror);
  applyGlowBlendDefaults(material);
  return finishStarColourMaterial(material, deps.u, v, gates, entryGate, kernel, coreMask);
}
