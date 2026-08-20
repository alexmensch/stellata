// The D4 disc split in TSL: two pipelines over the same geometry and
// blend state replacing the WebGL2 disc pass and its far-plane halo
// write. The core draw writes fixed-function depth; the halo draw writes
// none, so it is depth-HONEST — a mesh behind the host no longer punches
// a hole in the annulus, and neither pipeline touches fragment depth
// (../README.md § Early-z).

import { Discard, Fn, length } from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import { PHYS_RATIO_THRESHOLD } from '../../star-pipeline/local-pass/star-local-cluster-pure';
import { applyDiscBlendDefaults } from '../../star-pipeline/star-pipeline';
import { STAR_PASS_DISC } from '../../star-pipeline/star-pass';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import {
  makeStarColourMaterial, starEmissionColour, starGlowNode, starMrtStruct,
  type StarColourMaterial,
} from './star-emission-tsl';
import {
  buildStarVaryings, buildStarVertexNode, type StarTslDeps,
} from './star-vertex-tsl';

function buildDiscMaterial(
  deps: StarTslDeps,
  gates: EmitterGateNodes,
  half: 'core' | 'halo',
): StarColourMaterial {
  const v = buildStarVaryings();

  const glowValue = Fn(() => {
    Discard(length(v.vUv).greaterThan(0.5));
    Discard(v.vPhysRatio.lessThan(PHYS_RATIO_THRESHOLD));
    // The taper region is glow-only: a resolved disc at threshold would
    // render as a sub-pixel speck and read as a hard cutoff anyway.
    Discard(v.vAppMag.greaterThan(deps.u.uThresholdMag));

    const glow = starGlowNode(deps.u, v).toVar();
    Discard(glow.lessThan(deps.u.uDiscardThreshold));
    if (half === 'core') {
      Discard(glow.lessThan(deps.u.uCoreThreshold));
    } else {
      Discard(glow.greaterThanEqual(deps.u.uCoreThreshold));
    }
    return glow;
  });

  const material = new NodeMaterial();
  material.name = `star-disc-${half}-tsl`;
  material.vertexNode = buildStarVertexNode(deps, STAR_PASS_DISC, v);
  material.transparent = true;
  applyDiscBlendDefaults(material);
  if (half === 'halo') material.depthWrite = false;

  const singleGlow = glowValue();
  const structGlow = glowValue();
  return makeStarColourMaterial(
    material,
    Fn(() => starEmissionColour(deps.u, v, singleGlow))(),
    starMrtStruct(deps.u, v, structGlow, gates),
  );
}

export const buildStarDiscCoreMaterial = (deps: StarTslDeps, gates: EmitterGateNodes) =>
  buildDiscMaterial(deps, gates, 'core');

export const buildStarDiscHaloMaterial = (deps: StarTslDeps, gates: EmitterGateNodes) =>
  buildDiscMaterial(deps, gates, 'halo');
