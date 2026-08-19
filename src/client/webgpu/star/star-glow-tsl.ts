// The D2 glow pipeline in TSL: star.vert.glsl's vertex stage plus the
// glow-pass fragment, compile-time specialized (no uRenderMode), no depth
// output. Scope and the deferred siblings: README.md.

import {
  Fn, If, atan, clamp, cos, distance, dot, float, fract, instanceIndex, int,
  length, log, max, min, pow, select, smoothstep, sqrt, texture, uint,
  varyingProperty, vec2, vec4, cameraProjectionMatrix, modelViewMatrix,
  Discard,
} from 'three/tsl';
import { NodeMaterial, type Node } from 'three/webgpu';
import type * as THREE from 'three';
import {
  BALLESTEROS_BV_SCALE, BALLESTEROS_DISC_K2, BALLESTEROS_QUAD_LINEAR, BALLESTEROS_T0,
} from '../../../../scripts/colour/blackbody-lut-pure';
import { BV_MAX, BV_MIN } from '../../star-pipeline/blackbody-lut';
import { PHYS_RATIO_THRESHOLD } from '../../star-pipeline/local-pass/star-local-cluster-pure';
import { applyGlowBlendDefaults } from '../../star-pipeline/star-pipeline';
import { packedScalar } from '../attribute-packing';
import type { Vec4PackPlan } from '../attribute-packing-pure';
import { pointSourcePeakTsl } from '../emission-tsl';
import type { SharedUniformNodes } from '../shared-uniform-nodes';
import { lumaWeightsTsl, tonemapUnditheredTsl } from '../tonemap-tsl';
import { attrVec2, attrVec3 } from '../tsl-shim';
import {
  perceptualAppSizePxTsl,
  perceptualDiscExponentTsl,
  perceptualDiscProfileTsl,
  perceptualDmEffTsl,
} from './perceptual-disc-tsl';

type NF = Node<'float'>;

const ballesterosBvFromTeffTsl = /* @__PURE__ */ Fn(([teff]: [NF]) => {
  const k = teff.div(BALLESTEROS_T0);
  const disc = sqrt(k.mul(k).mul(BALLESTEROS_DISC_K2).add(4.0));
  const u = float(2.0).sub(k.mul(BALLESTEROS_QUAD_LINEAR)).add(disc).div(k.mul(2.0));
  return u.div(BALLESTEROS_BV_SCALE);
});

export interface StarGlowTslDeps {
  u: SharedUniformNodes;
  staticPlan: Vec4PackPlan;
  dynamicPlan: Vec4PackPlan;
  /** The blackbody LUT, bound per layer — texture slots are not part of
   *  the shared uniform-node mirror (../shared-uniform-nodes.ts). */
  lut: THREE.DataTexture;
}

export function buildStarGlowMaterial(deps: StarGlowTslDeps): NodeMaterial {
  const { u, staticPlan, dynamicPlan, lut } = deps;
  const stat = (name: string) => packedScalar(staticPlan, name);
  const dyn = (name: string) => packedScalar(dynamicPlan, name);

  const vAppMag = varyingProperty('float', 'vAppMag');
  const vColor = varyingProperty('vec3', 'vColor');
  const vUv = varyingProperty('vec2', 'vUv');
  const vPhysRatio = varyingProperty('float', 'vPhysRatio');
  const vSoftness = varyingProperty('float', 'vSoftness');
  const vPeakL = varyingProperty('float', 'vPeakL');

  const ciToColor = Fn(([bv]: [NF]) => {
    const t = clamp(bv.sub(BV_MIN).div(BV_MAX - BV_MIN), 0.0, 1.0);
    const chroma = texture(lut, vec2(t, 0.5)).rgb;
    return chroma.div(max(dot(chroma, lumaWeightsTsl()), 1e-6));
  });

  const vertexNode = Fn(() => {
    const corner = attrVec2('aCorner');
    const localPos = attrVec3('iPosition');
    const puls = attrVec2('iPuls');
    const self = int(instanceIndex);

    // The off-screen clip sentinel of star.vert.glsl's early returns;
    // TSL has no value-carrying return, so the draw path assigns over it.
    const clipOut = vec4(2.0, 2.0, 2.0, 1.0).toVar();

    const m0 = u.uLocalMemberIdx0;
    const m1 = u.uLocalMemberIdx1;
    const isMember = self.equal(m0.x).or(self.equal(m0.y))
      .or(self.equal(m0.z)).or(self.equal(m0.w))
      .or(self.equal(m1.x)).or(self.equal(m1.y))
      .or(self.equal(m1.z)).or(self.equal(m1.w));
    const eclipseDim = dyn('iEclipseDim');
    // Which flags collapse glow, and why iCompositeSuppress is absent:
    // README.md § Suppression semantics.
    const suppressed = self.equal(u.uHideFocusIdx)
      .or(isMember)
      .or(eclipseDim.lessThanEqual(0.0));

    If(suppressed.not(), () => {
      const dPc = max(distance(localPos, u.uCameraPos), 1e-30).toVar();
      const appMag = stat('iAbsmag')
        .add(log(dPc).mul(1 / Math.LN10).sub(1.0).mul(5.0)).toVar();

      const radiusFactor = float(1.0).toVar();
      const ciMod = float(0.0).toVar();
      const periodDays = stat('iPeriodDays');
      const pulsating = periodDays.greaterThan(0.0)
        .and(stat('iAmplitudeMag').greaterThan(0.0))
        .and(dyn('iSuppressPulsation').lessThan(0.5));
      If(pulsating, () => {
        const minModelDays = u.uModelDaysPerRealSec.mul(u.uMinPeriodSec);
        const periodEff = max(periodDays, minModelDays);
        const phase = fract(u.uModelDays.div(periodEff));
        const c = cos(phase.mul(2 * Math.PI));
        appMag.addAssign(stat('iAmplitudeMag').mul(-0.5).mul(c));
        radiusFactor.assign(pow(puls.x, c.mul(-0.5)));
        ciMod.assign(puls.y.mul(-0.5).mul(c));
      });

      If(eclipseDim.lessThan(1.0), () => {
        appMag.addAssign(log(eclipseDim).mul(-2.5 / Math.LN10));
      });

      const spectOk = u.uSpectMask
        .bitAnd(uint(1).shiftLeft(uint(stat('iSpectClass'))))
        .notEqual(uint(0));
      const distSol = stat('iDistSol');
      const distOk = distSol.greaterThanEqual(u.uMinDistSol)
        .and(distSol.lessThanEqual(u.uMaxDistSol));
      const magOk = appMag.lessThanEqual(u.uCullMag);

      If(spectOk.and(distOk).and(magOk), () => {
        const teff = stat('iTeffApsis');
        const intrinsicBv = select(
          teff.greaterThan(0.0), ballesterosBvFromTeffTsl(teff), stat('iCi'));
        const effectiveCi = intrinsicBv.add(ciMod);

        const lumRaw = stat('iLumClass');
        const lumClass = select(lumRaw.lessThan(100.0), lumRaw, 2.0);
        const softness = clamp(lumClass.div(9.0), 0.0, 1.0);

        vAppMag.assign(appMag);
        vColor.assign(ciToColor(effectiveCi));
        vUv.assign(corner);
        vSoftness.assign(softness);

        const dMEff = perceptualDmEffTsl(appMag, u.uLimitMag, u.uSizeSpan, u.uSizeKnee);
        const appSize = perceptualAppSizePxTsl(dMEff, u.uSizeMin, u.uSizeMax, u.uSizeSpan);

        const rPc = pow(10.0, stat('iLogRadius')).mul(u.uRSunPc);
        const angularToPx = u.uViewport.y.div(max(u.uFovYRad, 1e-9));
        const physSizeRaw = atan(rPc.mul(radiusFactor).div(dPc)).mul(2.0).mul(angularToPx);
        // The peak takes the UNCLAMPED physical radius (CSS px) — the
        // clamp below is display-only (../../star-pipeline/README.md
        // § Physical-luminance emission).
        vPeakL.assign(pointSourcePeakTsl(u.uExposure, appMag, physSizeRaw.mul(0.5)));

        const physSize = min(
          physSizeRaw, u.uMaxPhysFrac.mul(min(u.uViewport.x, u.uViewport.y)));
        const pxSize = max(appSize, physSize);
        vPhysRatio.assign(clamp(physSize.div(max(pxSize, 0.001)), 0.0, 1.0));

        const centreClip = cameraProjectionMatrix
          .mul(modelViewMatrix)
          .mul(vec4(localPos, 1.0))
          .toVar();
        If(self.equal(u.uPinFocusToCenter), () => {
          centreClip.assign(cameraProjectionMatrix.mul(vec4(0.0, 0.0, dPc.negate(), 1.0)));
        });
        // uPixelRatio cancels out of the GLSL's offset chain; both
        // uViewport and pxSize are CSS px.
        const ndcOffset = corner.mul(pxSize).div(u.uViewport).mul(2.0);
        clipOut.assign(centreClip.add(vec4(ndcOffset.mul(centreClip.w), 0.0, 0.0)));
      });
    });
    return clipOut;
  });

  const fragmentNode = Fn(() => {
    const r = length(vUv);
    Discard(r.greaterThan(0.5));
    Discard(vPhysRatio.greaterThanEqual(PHYS_RATIO_THRESHOLD));

    const n = perceptualDiscExponentTsl(
      vSoftness, vPhysRatio, u.uDistNMin, u.uDistNMax, u.uLumBiasMin, u.uLumBiasMax);
    const glow = perceptualDiscProfileTsl(r, n, u.uVisibleThreshold, u.uVisibleK).toVar();
    const taper = float(1.0)
      .sub(smoothstep(u.uThresholdMag, u.uThresholdMag.add(0.5), vAppMag));
    glow.mulAssign(taper);

    const emitted = vColor.mul(vPeakL.mul(glow));
    return select(
      u.uHdrTarget.greaterThan(0.5),
      vec4(emitted, glow),
      vec4(tonemapUnditheredTsl(emitted, u.uWhitePoint, u.uHighlightDesat), glow),
    );
  });

  const material = new NodeMaterial();
  material.name = 'star-glow-tsl';
  material.vertexNode = vertexNode();
  material.fragmentNode = fragmentNode();
  applyGlowBlendDefaults(material);
  return material;
}
