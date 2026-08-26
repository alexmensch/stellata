// cloud-rim.frag.glsl on the TSL path: the Local-Bubble fresnel treatment
// in realistic mode, a stippled silhouette contour in chart mode. The
// vertex stage is the shared one, which here means none at all.

import { AdditiveBlending, FrontSide } from 'three';
import {
  Discard, If, abs, dFdx, dFdy, float, fract, length, max, normalView,
  positionView, screenCoordinate, smoothstep, vec3, vec4,
} from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import { DITHER_SEED_OFFSET } from '../../hdr/tonemap/tonemap-pure';
import {
  CONTOUR_WIDTH, MIN_FWIDTH, STIPPLE_ALPHA_FLOOR, STIPPLE_DOT_RADIUS,
  STIPPLE_DOT_SOFTNESS, STIPPLE_PERIOD_PX,
} from '../../molecular-clouds/cloud-rim-pure';
import { fresnelRimAlphaTsl } from '../fresnel-shell/fresnel-rim-tsl';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import { lsbDitherTsl } from '../tsl/jitter-tsl';
import type { CloudRimNodes } from './cloud-uniform-nodes';

export function buildCloudRimMaterial(r: CloudRimNodes): MrtEmitterMaterial {
  const material = new NodeMaterial();
  material.name = 'cloud-rim-tsl';
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = false;
  material.blending = AdditiveBlending;
  material.side = FrontSide;

  // No vertexNode — both varyings are TSL built-ins, the same reason the
  // boundary shells carry none (`../fresnel-shell/README.md`).
  return finishMrtMaterial(material, () => {
    const n = normalView.normalize();
    const viewDir = positionView.negate().normalize();

    const ink = vec3(0.0).toVar();
    const alpha = float(0.0).toVar();
    // uChart is a uniform, so this is uniform control flow: one arm is
    // skipped outright rather than both being evaluated for a select, and
    // the derivatives below stay legal in WGSL.
    If(r.uChart.greaterThan(0.5), () => {
      const ndotv = max(n.dot(viewDir), 0.0).toVar();
      // TSL has no fwidth node; this is what GLSL defines it as.
      const fw = max(abs(dFdx(ndotv)).add(abs(dFdy(ndotv))), MIN_FWIDTH).toVar();
      const band = float(1.0).sub(
        smoothstep(fw.mul(CONTOUR_WIDTH), fw.mul(2.0 * CONTOUR_WIDTH), ndotv));
      const cell = fract(screenCoordinate.xy.div(STIPPLE_PERIOD_PX)).sub(0.5);
      const dotMask = float(1.0).sub(smoothstep(
        float(STIPPLE_DOT_RADIUS - STIPPLE_DOT_SOFTNESS),
        float(STIPPLE_DOT_RADIUS + STIPPLE_DOT_SOFTNESS),
        length(cell)));
      ink.assign(r.uInk);
      alpha.assign(band.mul(dotMask).mul(r.uInkAlpha));
      Discard(alpha.lessThanEqual(STIPPLE_ALPHA_FLOOR));
    }).Else(() => {
      // The whisper-level rim spans only a handful of 8-bit levels, so it
      // bands even on a smooth mesh.
      const rimAlpha = r.uOpacity.mul(fresnelRimAlphaTsl(
        n, viewDir, r.uAlphaLimb, r.uFaceOnFloor, r.uFresnelPower)).toVar();
      Discard(rimAlpha.lessThanEqual(0.0));
      ink.assign(r.uColour);
      alpha.assign(max(
        rimAlpha.add(lsbDitherTsl(screenCoordinate.xy.add(DITHER_SEED_OFFSET))), 0.0));
    });

    // Chrome: no claim on the light already in the target, so both extra
    // attachments take the blend's identity element.
    return { colour: vec4(ink, alpha), statistic: vec4(0.0), diffuse: vec4(0.0) };
  });
}
