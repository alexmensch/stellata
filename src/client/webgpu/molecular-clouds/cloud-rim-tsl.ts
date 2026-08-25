// cloud-rim.frag.glsl on the TSL path: the Local-Bubble fresnel treatment
// in realistic mode, a stippled silhouette contour in chart mode. The
// vertex stage is the shared one, which here means none at all.

import { AdditiveBlending, FrontSide } from 'three';
import {
  Discard, abs, dFdx, dFdy, float, fract, length, max, normalView, positionView,
  screenCoordinate, select, smoothstep, vec4,
} from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import {
  CONTOUR_WIDTH, STIPPLE_ALPHA_FLOOR, STIPPLE_DOT_RADIUS, STIPPLE_DOT_SOFTNESS,
  STIPPLE_PERIOD_PX,
} from '../../molecular-clouds/cloud-rim-pure';
import { fresnelRimAlphaTsl } from '../fresnel-shell/fresnel-rim-tsl';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import { interleavedGradientNoiseTsl } from '../tsl/jitter-tsl';
import type { CloudRimNodes } from './cloud-uniform-nodes';

const DITHER_SEED_OFFSET = 113.7;
/** `fwidth` floor — a facet with zero screen-space gradient would give a
 *  zero-width band and drop the contour entirely. */
const MIN_FWIDTH = 1e-5;

export function buildCloudRimMaterial(r: CloudRimNodes): MrtEmitterMaterial {
  const material = new NodeMaterial();
  material.name = 'cloud-rim-tsl';
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = false;
  material.blending = AdditiveBlending;
  // FrontSide + outward winding is the hide-when-inside contract: the
  // shell culls with the camera inside the cloud, while the BackSide
  // absorption keeps working from in there.
  material.side = FrontSide;

  // No vertexNode — both varyings are TSL built-ins, the same reason the
  // boundary shells carry none (`../fresnel-shell/README.md`).
  return finishMrtMaterial(material, () => {
    const n = normalView.normalize();
    const viewDir = positionView.negate().normalize();
    const ndotv = max(n.dot(viewDir), 0.0).toVar();

    // Chart: an fwidth-scaled silhouette band masked by a screen-space dot
    // grid — the SkyAtlas 2000 nebula convention. TSL has no fwidth node,
    // so it is spelled out as the sum of the two derivatives' magnitudes,
    // which is what GLSL's fwidth is defined as.
    const fw = max(abs(dFdx(ndotv)).add(abs(dFdy(ndotv))), MIN_FWIDTH).toVar();
    const band = float(1.0).sub(
      smoothstep(fw.mul(CONTOUR_WIDTH), fw.mul(2.0 * CONTOUR_WIDTH), ndotv)).toVar();
    const cell = fract(screenCoordinate.xy.div(STIPPLE_PERIOD_PX)).sub(0.5);
    const dotMask = float(1.0).sub(smoothstep(
      float(STIPPLE_DOT_RADIUS - STIPPLE_DOT_SOFTNESS),
      float(STIPPLE_DOT_RADIUS + STIPPLE_DOT_SOFTNESS),
      length(cell)));
    const inkAlpha = band.mul(dotMask).mul(r.uInkAlpha).toVar();

    // Realistic: the shared rim shape, plus a ±0.5-LSB dither — the
    // whisper-level rim spans only a handful of 8-bit levels, so it bands
    // even on a smooth mesh.
    const rimAlpha = r.uOpacity.mul(fresnelRimAlphaTsl(
      n, viewDir, r.uAlphaLimb, r.uFaceOnFloor, r.uFresnelPower));
    const dither = interleavedGradientNoiseTsl(screenCoordinate.xy.add(DITHER_SEED_OFFSET))
      .sub(0.5).div(255.0);

    // One graph, both modes: uChart flips every frame-cheap thing here, and
    // a pipeline rebuild per chart toggle would cost more than the branch.
    // Both arms are evaluated — WGSL has no early return out of a discard —
    // so the discard condition is the union of what each mode drops.
    const chart = r.uChart.greaterThan(0.5);
    Discard(select(chart,
      inkAlpha.lessThanEqual(STIPPLE_ALPHA_FLOOR),
      rimAlpha.lessThanEqual(0.0)));

    const colour = select(chart,
      vec4(r.uInk, inkAlpha),
      vec4(r.uColour, max(rimAlpha.add(dither), 0.0)));
    // Chrome: no claim on the light already in the target, so both extra
    // attachments take the blend's identity element.
    return { colour, statistic: vec4(0.0), diffuse: vec4(0.0) };
  });
}
