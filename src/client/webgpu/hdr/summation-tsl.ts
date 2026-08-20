// TSL mirrors of the rod-summation convolution (stellata_summation) and
// its box downsample, over summation-pure's constants. The kernel rule
// and every bound: ../../hdr/summation/README.md.

import {
  Break, Fn, If, Loop, clamp, float, int, ivec2, length, max,
  screenCoordinate, select, vec2, vec3, vec4,
} from 'three/tsl';
import type { Node, TextureNode } from 'three/webgpu';
import {
  MAX_DOWNSAMPLE, MAX_KERNEL_REACH_TEXELS,
} from '../../hdr/summation/summation-pure';
import { min, textureSize } from '../tsl-shim';

type NF = Node<'float'>;
type N2 = Node<'vec2'>;

/**
 * Mean diffuse display luminance over the summation disc — the TSL twin
 * of `stellataSummationMean`. `source` must be the BASE texture node (its
 * `.value` is what the pass swaps between the raw attachment and the
 * downsampled copy); taps sample bilinearly through it, clamped to the
 * live sub-rect. Call inside a fragment Fn.
 */
export function summationMeanTsl(
  source: TextureNode,
  sourceTexel: N2,
  radiusTexels: NF,
  extent: N2,
) {
  const invSize = vec2(1.0, 1.0).div(vec2(textureSize(source, 0)));
  const hi = extent.sub(0.5);
  const acc = vec3(0.0).toVar();
  const weight = float(0.0).toVar();
  const reach = MAX_KERNEL_REACH_TEXELS;
  Loop({ start: int(-reach), end: int(reach), condition: '<=' }, ({ i }) => {
    const dy = i;
    Loop({ start: int(-reach), end: int(reach), condition: '<=' }, ({ i: dx }) => {
      const offset = vec2(float(dx), float(dy));
      const w = clamp(radiusTexels.add(0.5).sub(length(offset)), 0.0, 1.0);
      If(w.greaterThan(0.0), () => {
        const texel = clamp(sourceTexel.add(offset), vec2(0.5), hi);
        acc.addAssign(source.sample(texel.mul(invSize)).rgb.mul(w));
        weight.addAssign(w);
      });
    });
  });
  const centre = source.sample(clamp(sourceTexel, vec2(0.5), hi).mul(invSize)).rgb;
  return select(weight.greaterThan(0.0), acc.div(weight), centre);
}

/** The box-downsample fragment (summation-downsample.frag.glsl): average
 *  a `factor`-wide cell of `source`, clamping the ragged edge taps. */
export function buildSummationDownsampleFragment(
  source: TextureNode,
  factor: Node<'int'>,
  sourceSize: Node<'ivec2'>,
) {
  return Fn(() => {
    const base = ivec2(screenCoordinate).mul(factor);
    const acc = vec3(0.0).toVar();
    const n = float(0.0).toVar();
    Loop({ start: int(0), end: int(MAX_DOWNSAMPLE) }, ({ i }) => {
      const dy = i;
      // Braced so the arrow returns void: an implicit return hands the
      // Break node back as the branch output and it emits twice — the
      // second `break;` is WGSL-unreachable and warns on every boot.
      If(dy.greaterThanEqual(factor), () => { Break(); });
      Loop({ start: int(0), end: int(MAX_DOWNSAMPLE) }, ({ i: dx }) => {
        If(dx.greaterThanEqual(factor), () => { Break(); });
        const texel = min(base.add(ivec2(dx, dy)), sourceSize.sub(ivec2(1)));
        acc.addAssign(source.load(texel).rgb);
        n.addAssign(1.0);
      });
    });
    return vec4(acc.div(max(n, 1.0)), 1.0);
  })();
}
