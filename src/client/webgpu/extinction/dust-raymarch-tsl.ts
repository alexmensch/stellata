// TSL mirror of stellata_dust_raymarch (../../star-pipeline/extinction/
// dust-raymarch.glsl): the camera→star Edenhofer march returning raw
// physical A_V, shared by the prepass and the star vertex fallback.

import {
  If, Loop, abs, ceil, clamp, exp, float, int, length, max, min, texture3D,
} from 'three/tsl';
import type { Data3DTexture } from 'three';
import type { Node } from 'three/webgpu';
import {
  DUST_TAPS_MAX, DUST_TAPS_MIN, DUST_TAP_PC, SLAB_PARALLEL_EPS_PC,
} from '../../star-pipeline/extinction/dust-raymarch-pure';
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
 */
export function dustRaymarchAvTsl(
  u: SharedUniformNodes,
  dust: DustTextureNode,
  absFrom: N3,
  absTo: N3,
): NF {
  const delta = absTo.sub(absFrom).toVar();
  const lenPc = length(delta).toVar();
  const av = float(0.0).toVar();
  If(lenPc.greaterThanEqual(0.001), () => {
    const t0 = float(0.0).toVar();
    const t1 = float(1.0).toVar();
    for (const axis of ['x', 'y', 'z'] as const) {
      const f = absFrom[axis];
      const d = delta[axis];
      If(abs(d).greaterThan(SLAB_PARALLEL_EPS_PC), () => {
        const ta = u.uDustBoundsPc.negate().sub(f).div(d);
        const tb = u.uDustBoundsPc.sub(f).div(d);
        t0.assign(max(t0, min(ta, tb)));
        t1.assign(min(t1, max(ta, tb)));
      }).ElseIf(abs(f).greaterThan(u.uDustBoundsPc), () => {
        t0.assign(1.0);
        t1.assign(0.0);
      });
    }
    If(t1.greaterThan(t0), () => {
      const inCubeLenPc = t1.sub(t0).mul(lenPc).toVar();
      const tapsF = clamp(
        ceil(inCubeLenPc.div(DUST_TAP_PC)), DUST_TAPS_MIN, DUST_TAPS_MAX).toVar();
      const taps = int(tapsF).toVar();
      const invRange = float(0.5).div(u.uDustBoundsPc);
      const accumDensity = float(0.0).toVar();
      Loop({ start: int(0), end: taps, type: 'int', condition: '<' }, ({ i }) => {
        const t = t0.add(t1.sub(t0).mul(float(i).add(0.5).div(tapsF)));
        const uvw = clamp(absFrom.add(delta.mul(t)).mul(invRange).add(0.5), 0.0, 1.0);
        // Inverse of the build side's pure-log encoding over
        // [densityMin, densityMax].
        const encoded = dust.sample(uvw).r;
        accumDensity.addAssign(
          u.uDustDensityMin.mul(exp(encoded.mul(u.uDustLogRatio))));
      });
      av.assign(accumDensity.mul(inCubeLenPc.div(tapsF)).mul(u.uDustAvPerDensityPc));
    });
  });
  return av;
}
