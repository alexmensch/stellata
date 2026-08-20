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
import { starEmissionColour, starGlowNode } from './star-emission-tsl';
import {
  buildStarVaryings, buildStarVertexNode, type StarTslDeps,
} from './star-vertex-tsl';

function buildDiscMaterial(deps: StarTslDeps, half: 'core' | 'halo'): NodeMaterial {
  const v = buildStarVaryings();

  const fragmentNode = Fn(() => {
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
    return starEmissionColour(deps.u, v, glow);
  });

  const material = new NodeMaterial();
  material.name = `star-disc-${half}-tsl`;
  material.vertexNode = buildStarVertexNode(deps, STAR_PASS_DISC, v);
  material.fragmentNode = fragmentNode();
  material.transparent = true;
  applyDiscBlendDefaults(material);
  if (half === 'halo') material.depthWrite = false;
  return material;
}

export const buildStarDiscCoreMaterial = (deps: StarTslDeps) =>
  buildDiscMaterial(deps, 'core');

export const buildStarDiscHaloMaterial = (deps: StarTslDeps) =>
  buildDiscMaterial(deps, 'halo');
