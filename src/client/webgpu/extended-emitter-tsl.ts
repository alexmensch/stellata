// TSL mirror of the stellata_extended_emitter chunk: the write tail every
// extended-source emitter shares — column → gain → all three attachments,
// and the inline operator off-target. ../hdr/emission/README.md § Unit.

import { Fn, dot, min, select, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { LUMA_CEIL } from '../hdr/emission/emission-pure';
import { LUMA_WEIGHTS } from '../hdr/tonemap-pure';
import type { EmitterOutputs } from './hdr/mrt-material';
import { statisticTexelTsl, surfaceBrightnessLuminanceTsl } from './emission-tsl';
import { tonemapUnditheredTsl } from './tonemap-tsl';

type NF = Node<'float'>;
type N3 = Node<'vec3'>;

/** A raymarched column taken to display luminance at one solid angle,
 *  clamped at the ceiling. The gain is unclamped by contract, so the
 *  CALLER clamps the product — which is what this is. */
export const gainedColumnTsl = /* @__PURE__ */ Fn(
  ([column, exposure, magPerArcsec2, omegaArcsec2]: [N3, NF, NF, NF]) =>
    min(
      column.mul(surfaceBrightnessLuminanceTsl(exposure, magPerArcsec2, omegaArcsec2)),
      vec3(LUMA_CEIL)),
);

export interface ExtendedEmitterInputs {
  /** The layer's own integrated column, per channel, carrying whatever
   *  chromaticity the raymarch built. */
  column: N3;
  exposure: NF;
  /** The surface brightness a unit column represents. */
  magPerArcsec2: NF;
  omegaSummationArcsec2: NF;
  omegaPxArcsec2: NF;
  /** 1 while the MRT target is bound; 0 in chart mode, where the operator
   *  runs here instead. */
  hdrTarget: NF;
  whitePoint: NF;
  highlightDesat: NF;
}

/**
 * Three attachments, each taking a different quantity.
 *
 * `diffuse` (attachment 2) is the display value gained by the eye's rod
 * summation solid angle — **pre-summation**. It is only the flux inside
 * that patch once the resolve has averaged it, which is the whole reason
 * it is a separate attachment (`../hdr/summation/README.md`). Attachment 0
 * stays black for a diffuse fragment on-target: the resolve owns that
 * write.
 *
 * `statistic` (attachment 1) takes `omegaPxArcsec2` instead — the display
 * concession is not light, and the adaptation model reads retinal
 * illuminance. Extended source, so flux and peak are the same quantity and
 * alpha is 1: the additive blend must SUM the statistic rather than scale
 * it a second time.
 *
 * Off-target there is no attachment 2 and no pass to convolve it, so the
 * summation anchor is gone entirely and the emitter falls back to the pixel
 * solid angle — one rule, not a per-layer opt-out, because the concession
 * IS the pass. The operator runs here in that case, **undithered**: these
 * layers stack several fragments on one pixel and the dither keys on the
 * fragment position alone, so it would bias rather than cancel.
 *
 * The GLSL's early `return` on-target becomes a `select`: WGSL has no
 * value-carrying return out of a branch, and both arms are cheap.
 */
export const emitExtendedSourceTsl = (i: ExtendedEmitterInputs): EmitterOutputs => {
  const physicalL = dot(i.column, vec3(...LUMA_WEIGHTS)).mul(
    surfaceBrightnessLuminanceTsl(i.exposure, i.magPerArcsec2, i.omegaPxArcsec2));

  // Clamped before the convolution rather than after, so fp16 additive
  // accumulation across overlapping volumes cannot overflow.
  const diffuse = vec4(
    gainedColumnTsl(i.column, i.exposure, i.magPerArcsec2, i.omegaSummationArcsec2), 1.0);

  const inline = vec4(tonemapUnditheredTsl(
    gainedColumnTsl(i.column, i.exposure, i.magPerArcsec2, i.omegaPxArcsec2),
    i.whitePoint, i.highlightDesat), 1.0);

  return {
    colour: select(i.hdrTarget.greaterThan(0.5), vec4(0.0), inline),
    statistic: statisticTexelTsl(physicalL, 0.0, 1.0),
    diffuse,
  };
};

/** Every attachment cleared for a fragment the volume does not cover.
 *  Neither attachment 1 nor 2 has a default: skip one on one branch and it
 *  reads whatever the texel last held. */
export const emitNothingTsl = (): EmitterOutputs => ({
  colour: vec4(0.0), statistic: vec4(0.0), diffuse: vec4(0.0),
});
