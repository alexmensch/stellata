// planet-atmosphere.frag.glsl on the TSL path: the limb halo for rays that
// miss the disc, composited premultiplied-over. Model:
// ../../solar-system/atmosphere/README.md.

import {
  AddEquation, CustomBlending, NodeMaterial, OneFactor, OneMinusSrcAlphaFactor,
} from 'three/webgpu';
import {
  Discard, If, dot, float, max, min, normalView, screenCoordinate, select,
  vec3, vec4,
} from 'three/tsl';
import { LUMA_CEIL } from '../../hdr/emission/emission-pure';
import { maskedStatisticTexelTsl, occluderTexelTsl } from '../emission-tsl';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import type { SharedUniformNodes } from '../shared-uniform-nodes';
import { lumaWeightsTsl, tonemapUnditheredTsl } from '../tonemap-tsl';
import {
  atmoJitterTsl, atmoLumaTsl, atmosphereRadianceTsl, deflattenedCameraTsl,
  deflattenedDirTsl, hitsBodyAheadTsl, litFractionTsl, shadowSpanTsl,
  shellEntryTsl,
} from './atmosphere-scatter-tsl';
import type { PlanetAtmosphereNodes } from './uniform-nodes';

export function buildPlanetAtmosphereMaterial(
  u: SharedUniformNodes,
  p: PlanetAtmosphereNodes,
  gates: EmitterGateNodes,
): MrtEmitterMaterial {
  const material = new NodeMaterial();
  material.name = 'planet-atmosphere-tsl';
  material.transparent = true;
  // Premultiplied over (not additive): the shell adds airlight AND
  // occludes the background by its opacity, so a dense limb chord that
  // scatters no light toward the eye still extincts the stars behind it.
  material.blending = CustomBlending;
  material.blendEquation = AddEquation;
  material.blendSrc = OneFactor;
  material.blendDst = OneMinusSrcAlphaFactor;
  material.depthWrite = false;
  material.depthTest = true;

  return finishMrtMaterial(material, () => {
    // The shell mesh is a uniform sphere, so its renormalized normal is
    // exactly radial — reconstructing the surface point from it avoids the
    // faceting grid the interpolated position would feed the march.
    const shellPoint = p.uCenterView
      .add(normalView.mul(p.uRadiusPc.mul(p.uAtmoRadius)));
    // Everything below is in the unit-sphere frame (README § Shell extents).
    const dir = deflattenedDirTsl(
      shellPoint.normalize(), p.uPoleView, p.uPolarRadiusR).toVar();
    const o = deflattenedCameraTsl(
      p.uCenterView, p.uRadiusPc, p.uPoleView, p.uPolarRadiusR).toVar();
    const sunDir = deflattenedDirTsl(
      p.uSunDirView, p.uPoleView, p.uPolarRadiusR).toVar();

    const shell = shellEntryTsl(o, dir, p.uAtmoRadius).toVar();
    // Rays that strike the body ahead of the camera belong to the lit disc
    // — the mesh shader paints their airlight; the shell handles the limb.
    const onLimb = shell.x.greaterThan(0.0).and(shell.z.greaterThan(0.0))
      .and(hitsBodyAheadTsl(o, dir).not()).toVar();
    Discard(onLimb.not());

    const col = vec3(0.0).toVar();
    const a = float(0.0).toVar();
    const airL = float(0.0).toVar();
    const litFrac = float(0.0).toVar();
    // WGSL's `discard` is not a return — the invocation runs on. Guarding
    // the march is what keeps a disc-bound ray from paying for one.
    If(onLimb, () => {
      const tStart = max(shell.y, 0.0).toVar();
      const march = atmosphereRadianceTsl({
        o, d: dir, tStart, tStop: shell.z, rAtmo: p.uAtmoRadius, sunDir,
        hR: p.uScaleHeightR, hM: p.uScaleHeightM, betaRs: p.uBetaRayleigh,
        betaMs: p.uBetaMie, betaA: p.uBetaAbsorb, g: p.uMieG,
        jitter: atmoJitterTsl(screenCoordinate.xy),
      });

      // Share of the chord outside the shadow, over the chord as one
      // segment. The mask cannot collapse to opacity alone: the night-limb
      // chord is the DENSE one, so it would claim the whole limb while
      // scattering nothing.
      const span = shadowSpanTsl(o, dir, sunDir).toVar();
      const halfChord = max(shell.z.sub(tStart).mul(0.5), 1e-12).toVar();
      litFrac.assign(litFractionTsl(
        tStart.add(halfChord), halfChord, span.x, span.y));

      // The operator runs on the airlight radiance, before uFade
      // premultiplies it — the crossfade is a compositing weight, not part
      // of the light the operator sees.
      col.assign(min(
        march.inscatter.mul(p.uSunColour).mul(p.uAirlightLuminance),
        vec3(LUMA_CEIL)));
      airL.assign(dot(col, lumaWeightsTsl()).mul(p.uFade));
      // Alpha = medium opacity along the chord (1 − luminance
      // transmittance), so the premultiplied-over shell occludes the
      // background even where it adds no airlight.
      a.assign(float(1.0).sub(atmoLumaTsl(march.transmittance)).mul(p.uFade));
    });
    // Undithered: the shell overlaps the body mesh's own fragments at the
    // limb (../../hdr/README.md § Operator).
    const shown = select(
      u.uHdrTarget.lessThan(0.5),
      tonemapUnditheredTsl(col, u.uWhitePoint, u.uHighlightDesat),
      col);
    return {
      colour: vec4(shown.mul(p.uFade), a),
      statistic: maskedStatisticTexelTsl(
        gates.statisticWrites, airL, a.mul(litFrac), a),
      diffuse: occluderTexelTsl(a),
    };
  });
}
