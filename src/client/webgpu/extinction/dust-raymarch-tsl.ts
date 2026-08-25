// TSL mirror of stellata_dust_raymarch (../../star-pipeline/extinction/
// dust-raymarch.glsl): the camera→star Edenhofer march returning raw
// physical A_V, shared by the prepass and the star vertex fallback.

import { If, Loop, all, exp, float, length, texture3D, vec3 } from 'three/tsl';
import type { Data3DTexture } from 'three';
import type { Node } from 'three/webgpu';
import { DUST_STEPS } from '../../star-pipeline/extinction/dust-raymarch-pure';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';

type NF = Node<'float'>;
type N3 = Node<'vec3'>;

export type DustTextureNode = ReturnType<typeof texture3D>;

/** The volume as a sampling node. Not part of the shared uniform-node
 *  mirror: a uniform node cannot carry a nullable texture, so each
 *  consumer binds its own node over a placeholder and swaps `.value`
 *  when `attachDust` lands (../tsl/README.md § Shared uniform nodes). */
export function dustTextureNode(placeholder: Data3DTexture): DustTextureNode {
  return texture3D(placeholder);
}

/**
 * Raw physical A_V between two ABSOLUTE (heliocentric ICRS) positions in
 * parsecs — the dust grid is anchored to Sol, not the renderer's floating
 * local origin. Callers apply the `uDustEnabled × uExtinctionStrength`
 * gating themselves, exactly as the GLSL chunk's callers do.
 *
 * Sampling outside the cube clamps to the volume's zero-padded edge, so
 * the bbox test is an optimisation and dropping it would still integrate
 * correctly. It is expressed as the branch it guards rather than the
 * GLSL's `continue`: a jump out of a concise arrow is emitted twice
 * (../tsl/README.md § TSL test pattern).
 */
export function dustRaymarchAvTsl(
  u: SharedUniformNodes,
  dust: DustTextureNode,
  absFrom: N3,
  absTo: N3,
): NF {
  const delta = absTo.sub(absFrom).toVar();
  const lenPc = length(delta).toVar();
  const accumDensity = float(0.0).toVar();
  If(lenPc.greaterThanEqual(0.001), () => {
    const invRange = float(0.5).div(u.uDustBoundsPc);
    Loop(DUST_STEPS, ({ i }) => {
      const t = float(i).add(0.5).div(DUST_STEPS);
      const uvw = absFrom.add(delta.mul(t)).mul(invRange).add(0.5).toVar();
      If(all(uvw.greaterThanEqual(vec3(0.0))).and(all(uvw.lessThanEqual(vec3(1.0)))), () => {
        // Inverse of the build side's pure-log encoding over
        // [densityMin, densityMax].
        const encoded = dust.sample(uvw).r;
        accumDensity.addAssign(
          u.uDustDensityMin.mul(exp(encoded.mul(u.uDustLogRatio))));
      });
    });
  });
  return accumDensity.mul(lenPc.div(DUST_STEPS)).mul(u.uDustAvPerDensityPc);
}
