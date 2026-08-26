// planet-rings.frag.glsl on the TSL path: the radial strip, the lit and
// transmitted faces, and the analytic body shadow toward the host.
// Physics: ../../solar-system/planets/rings/README.md.

import {
  clamp, dot, float, length, max, min, mix, positionGeometry, select,
  smoothstep, step, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { DoubleSide, NodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { LUMA_CEIL } from '../../hdr/emission/emission-pure';
import {
  RING_BACKLIT_TRANSMIT, RING_SHADOW_FLOOR,
} from '../../solar-system/planets/rings/ring-photometry-pure';
import { maskedStatisticTexelTsl, occluderTexelTsl } from '../emission-tsl';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { lumaWeightsTsl, tonemapUnditheredTsl } from '../tonemap-tsl';
import type { PlanetRingsNodes } from './uniform-nodes';

type N3 = Node<'vec3'>;

/** Lambertian reflectance → radiance. */
const INV_PI = 1 / Math.PI;

/** Far root of `o + t·d` against the body spheroid: scale space so it
 *  becomes a unit sphere, solve the quadratic. A miss returns a large
 *  negative, so it fails the shadow test the same way a root behind the
 *  fragment does. */
function bodyFarRoot(o: N3, d: N3, eqPc: Node<'float'>, polarPc: Node<'float'>) {
  const os = vec3(o.xy.div(eqPc), o.z.div(polarPc));
  const ds = vec3(d.xy.div(eqPc), d.z.div(polarPc));
  const a = dot(ds, ds);
  const b = dot(os, ds).mul(2.0);
  const c = dot(os, os).sub(1.0);
  const disc = b.mul(b).sub(a.mul(c).mul(4.0));
  return select(
    disc.lessThan(0.0),
    -1e30,
    b.negate().add(disc.max(0.0).sqrt()).div(a.mul(2.0)));
}

export function buildPlanetRingsMaterial(
  u: SharedUniformNodes,
  p: PlanetRingsNodes,
  gates: EmitterGateNodes,
): MrtEmitterMaterial {
  const material = new NodeMaterial();
  material.name = 'planet-rings-tsl';
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = DoubleSide;

  return finishMrtMaterial(material, () => {
    const localXY = varying(positionGeometry.xy, 'vLocalXY');
    const frag = vec3(localXY.mul(p.uOuterPc), 0.0).toVar();

    const r = length(localXY);
    const uCoord = clamp(
      r.sub(p.uInnerRatio).div(max(float(1.0).sub(p.uInnerRatio), 1e-9)), 0.0, 1.0);
    const strip = p.uRingMap.sample(vec2(uCoord, 0.5)).toVar();

    // Whether the strip is illuminated at all: out of the body's shadow
    // (the ray toward the sun misses it), and the sun far enough off the
    // plane to light the annulus. Both faces count — transmitted light is
    // light.
    const unshadowed = step(
      bodyFarRoot(frag, p.uSunDirLocal, p.uEqRadiusPc, p.uPolarRadiusPc), 0.0);
    const lit = mix(RING_SHADOW_FLOOR, 1.0, unshadowed)
      .mul(smoothstep(0.0, 0.02, p.uSunDirLocal.z.abs())).toVar();

    // Reflected on the sunlit face, dimmer transmitted light on the far
    // face. The phase factor rides `light` and NOT `lit`: it scales flux,
    // and folding it into the coverage mask below would have the opposition
    // surge voting on how much lit surface the exposure pin sees.
    const sameSide = step(0.0, p.uSunDirLocal.z.mul(p.uCamPosLocal.z));
    const light = mix(RING_BACKLIT_TRANSMIT, 1.0, sameSide).mul(lit).mul(p.uRingPhaseScale);

    const col = min(
      strip.rgb.mul(light).mul(p.uAirlightLuminance).mul(INV_PI),
      vec3(LUMA_CEIL)).toVar();
    const ringL = dot(col, lumaWeightsTsl());
    const alpha = strip.a.mul(p.uFade).toVar();
    // Undithered — the annulus alpha-blends over the body mesh, so a pixel
    // can take both fragments (../../hdr/tonemap/README.md § Operator).
    const shown = select(
      u.uHdrTarget.lessThan(0.5),
      tonemapUnditheredTsl(col, u.uWhitePoint, u.uHighlightDesat),
      col);
    return {
      colour: vec4(shown, alpha),
      statistic: maskedStatisticTexelTsl(
        gates.statisticWrites, ringL, step(0.5, lit), alpha),
      diffuse: occluderTexelTsl(alpha),
    };
  });
}
