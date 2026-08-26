// star.vert.glsl's vertex stage as one TSL builder, compile-time
// specialized per pass (star-pass.ts) — suppression set, eclipse fold,
// and the core mask's member near-pin are the only per-pass differences.

import {
  Fn, If, atan, clamp, cos, distance, dot, float, fract, instanceIndex, int,
  ivec2, log, max, min, mix, pow, select, smoothstep, sqrt, texture, uint,
  varyingProperty, vec2, vec4, cameraProjectionMatrix, modelViewMatrix,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type * as THREE from 'three';
import {
  BALLESTEROS_BV_SCALE, BALLESTEROS_DISC_K2, BALLESTEROS_QUAD_LINEAR, BALLESTEROS_T0,
} from '../../../../scripts/colour/blackbody-lut-pure';
import { BV_MAX, BV_MIN } from '../../star-pipeline/blackbody-lut';
import { GLOW_COLLAPSE_FLOOR_L } from '../../star-pipeline/collapse/glow-collapse-pure';
import {
  PHYS_RATIO_THRESHOLD,
} from '../../star-pipeline/local-pass/star-local-cluster-pure';
import {
  STAR_PASS_CORE_MASK, STAR_PASS_GLOW, type StarPass,
} from '../../star-pipeline/star-pass';
import { SOFT_TAPER_MARGIN_MAG } from '../../solar-system/perceptual-magnitude';
import { R_V } from '../../star-pipeline/extinction/dust-raymarch-pure';
import { AV_TEX_WIDTH } from '../../star-pipeline/extinction/extinction-prepass-pure';
import { packedScalar } from '../tsl/attribute-packing';
import type { Vec4PackPlan } from '../tsl/attribute-packing-pure';
import { kernelFluxPeakTsl, pointSourcePeakTsl } from '../emission-tsl';
import { dustRaymarchAvTsl, type DustTextureNode } from '../extinction/dust-raymarch-tsl';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { lumaWeightsTsl } from '../tonemap-tsl';
import { attrFloat, attrVec2, attrVec3 } from '../tsl/tsl-shim';
import {
  perceptualAppSizePxTsl,
  perceptualDiscExponentTsl,
  perceptualDiscFluxIntegralTsl,
  perceptualDmEffTsl,
} from '../perceptual-disc-tsl';

type NF = Node<'float'>;

/** How far inside the reversed-z near clip bound (z_ndc = 1) the member
 *  stamp lands. Exactly z = +w risks the primitive clipping on float
 *  rounding; one ulp-scale step inside is depth-indistinguishable from
 *  the GLSL build's absolute-nearest gl_FragDepth = 0.0 stamp. */
export const CORE_MASK_NEAR_PIN_EPS = 1e-6;

const ballesterosBvFromTeffTsl = /* @__PURE__ */ Fn(([teff]: [NF]) => {
  const k = teff.div(BALLESTEROS_T0);
  const disc = sqrt(k.mul(k).mul(BALLESTEROS_DISC_K2).add(4.0));
  const u = float(2.0).sub(k.mul(BALLESTEROS_QUAD_LINEAR)).add(disc).div(k.mul(2.0));
  return u.div(BALLESTEROS_BV_SCALE);
});

export interface StarTslDeps {
  u: SharedUniformNodes;
  staticPlan: Vec4PackPlan;
  dynamicPlan: Vec4PackPlan;
  /** The blackbody LUT, bound per layer — texture slots are not part of
   *  the shared uniform-node mirror (../shared-uniform-nodes.ts). */
  lut: THREE.DataTexture;
  /** The dust volume the raymarch fallback samples, and the star-indexed
   *  A_V cache the prepass path fetches. Both nullable on the WebGL side,
   *  hence nodes over placeholders whose `.value` the layer swaps — a
   *  uniform node cannot carry a nullable texture. */
  dust: DustTextureNode;
  avPrepass: ReturnType<typeof texture>;
}

/** One set per material: the same varying node objects must be written by
 *  the vertex stage and read by the fragment stage of that material. */
export function buildStarVaryings() {
  return {
    vAppMag: varyingProperty('float', 'vAppMag'),
    vColor: varyingProperty('vec3', 'vColor'),
    vUv: varyingProperty('vec2', 'vUv'),
    vPhysRatio: varyingProperty('float', 'vPhysRatio'),
    vSoftness: varyingProperty('float', 'vSoftness'),
    /** One CSS pixel in vUv units — the chart fragment's edge-AA width.
     *  `fwidth(r)` cannot substitute: `length(vUv)`'s screen-space
     *  derivative is undefined at the quad centre, which left small quads
     *  a faint grey rather than solid ink. */
    vAaWidth: varyingProperty('float', 'vAaWidth'),
    vPeakL: varyingProperty('float', 'vPeakL'),
    vFluxPeakL: varyingProperty('float', 'vFluxPeakL'),
  };
}

export type StarVaryings = ReturnType<typeof buildStarVaryings>;

/**
 * `localMirror` builds the LOCAL_DEPTH_PASS variant for the mirror
 * geometry (star-local-mirror-tsl.ts): star identity comes from the
 * `iSourceIdx` slot attribute so hide/pin compares match the source
 * instance, member collapse is off (the mirror draws exactly the
 * members), and the core mask writes true bracket depth rather than the
 * main variant's near pin.
 */
export function buildStarVertexNode(
  deps: StarTslDeps,
  pass: StarPass,
  v: StarVaryings,
  localMirror = false,
): Node {
  const { u, staticPlan, dynamicPlan, lut, dust, avPrepass } = deps;
  const stat = (name: string) => packedScalar(staticPlan, name);
  const dyn = (name: string) => packedScalar(dynamicPlan, name);

  const ciToColor = Fn(([bv]: [NF]) => {
    const t = clamp(bv.sub(BV_MIN).div(BV_MAX - BV_MIN), 0.0, 1.0);
    const chroma = texture(lut, vec2(t, 0.5)).rgb;
    return chroma.div(max(dot(chroma, lumaWeightsTsl()), 1e-6));
  });

  return Fn(() => {
    const corner = attrVec2('aCorner');
    const localPos = attrVec3('iPosition');
    const puls = attrVec2('iPuls');
    const self = localMirror
      ? int(attrFloat('iSourceIdx').add(0.5))
      : int(instanceIndex);

    // The off-screen clip sentinel of star.vert.glsl's early returns;
    // TSL has no value-carrying return, so the draw path assigns over it.
    const clipOut = vec4(2.0, 2.0, 2.0, 1.0).toVar();

    const m0 = u.uLocalMemberIdx0;
    const m1 = u.uLocalMemberIdx1;
    const isMember = localMirror ? null
      : self.equal(m0.x).or(self.equal(m0.y))
        .or(self.equal(m0.z)).or(self.equal(m0.w))
        .or(self.equal(m1.x)).or(self.equal(m1.y))
        .or(self.equal(m1.z)).or(self.equal(m1.w));
    const eclipseDim = dyn('iEclipseDim');
    // A member keeps its core-mask draw (the stamp is what stops main-pass
    // background painting inside the core the local pass repaints); the two
    // colour passes collapse in favour of the mirror draws. Totality
    // collapses the glow quad alone, and iCompositeSuppress never gates
    // glow (README.md § Suppression semantics).
    const hidden = self.equal(u.uHideFocusIdx);
    const suppressed = (pass === STAR_PASS_GLOW
      ? (isMember === null ? hidden : hidden.or(isMember))
        .or(eclipseDim.lessThanEqual(0.0))
      : pass === STAR_PASS_CORE_MASK
        ? hidden.or(dyn('iCompositeSuppress').greaterThan(0.5))
        : (isMember === null ? hidden : hidden.or(isMember))
          .or(dyn('iCompositeSuppress').greaterThan(0.5)));

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

      const eclipseDimMag = float(0.0).toVar();
      if (pass === STAR_PASS_GLOW) {
        // Glow pass only: the disc pass resolves an eclipse occlusion
        // geometrically in the local depth pass, so folding the dim there
        // would dim the back disc's non-occluded fragments too. The
        // magnitude is kept so the pass split can be solved without it —
        // see the routeAppSize note below.
        If(eclipseDim.lessThan(1.0), () => {
          eclipseDimMag.assign(log(eclipseDim).mul(-2.5 / Math.LN10));
          appMag.addAssign(eclipseDimMag);
        });
      }

      const spectOk = u.uSpectMask
        .bitAnd(uint(1).shiftLeft(uint(stat('iSpectClass'))))
        .notEqual(uint(0));
      const distSol = stat('iDistSol');
      const distOk = distSol.greaterThanEqual(u.uMinDistSol)
        .and(distSol.lessThanEqual(u.uMaxDistSol));
      // Chart sizes and clips against uLimitMag in the fragment stage and
      // keeps its quads, so the taper cull is off there entirely — GLSL
      // twin is star.vert.glsl's `starTaperDead` early exit.
      const chart = u.uMonochrome.greaterThan(0.5);
      // Both bounds are read TWICE — once as the dust-independent
      // prefilter, once on the extincted magnitude — so each call builds
      // a fresh node that reads `appMag` where it is emitted.
      const magOk = () => appMag.lessThanEqual(u.uCullMag);
      const taperAlive = () => chart.or(pass === STAR_PASS_GLOW
        ? appMag.lessThan(u.uThresholdMag.add(SOFT_TAPER_MARGIN_MAG))
        : appMag.lessThanEqual(u.uThresholdMag));

      // Visibility prefilter — dust-independent. Spectral mask and
      // distance band are absolute; the magnitude and taper bounds are
      // monotonic in dust (A_V ≥ 0), so testing them ahead of the
      // extinction read is exact and is what keeps that read — a
      // texelFetch, or the full 48-tap march on the fallback — off the
      // culled population.
      If(spectOk.and(distOk).and(magOk()).and(taperAlive()), () => {
        // Survivors only. The prepass cache is one fetch of the star's own
        // texel; the fallback marches camera→star in ABSOLUTE space, since
        // the dust grid is anchored to Sol rather than to the renderer's
        // floating local origin.
        const dustEffective = u.uDustEnabled.mul(u.uExtinctionStrength).toVar();
        const absorbAV = float(0.0).toVar();
        If(dustEffective.greaterThan(0.0), () => {
          If(u.uAvPrepassEnabled.greaterThan(0.5), () => {
            const w = int(AV_TEX_WIDTH);
            absorbAV.assign(avPrepass
              .load(ivec2(self.mod(w), self.div(w))).r
              .mul(dustEffective));
          }).Else(() => {
            absorbAV.assign(dustRaymarchAvTsl(
              u, dust,
              u.uCameraPos.add(u.uWorldOffset),
              localPos.add(u.uWorldOffset),
            ).mul(dustEffective));
          });
        });
        appMag.addAssign(absorbAV);

        const teff = stat('iTeffApsis');
        const intrinsicBv = select(
          teff.greaterThan(0.0), ballesterosBvFromTeffTsl(teff), stat('iCi'));
        // Dust reddening and the variability colour swing shift the same
        // LUT input; reddening applies to whichever colour tier won.
        const effectiveCi = intrinsicBv.add(absorbAV.div(R_V)).add(ciMod);

        const lumRaw = stat('iLumClass');
        const lumClass = select(lumRaw.lessThan(100.0), lumRaw, 2.0);
        const softness = clamp(lumClass.div(9.0), 0.0, 1.0);

        // Both bounds again on the extincted value. The taper bound is the
        // LIVE uThresholdMag, so the EV trim moves it exactly as it moves
        // the fragment taper — which is what makes the cull bit-exact.
        If(magOk().and(taperAlive()), () => {
          v.vAppMag.assign(appMag);
          v.vColor.assign(ciToColor(effectiveCi));
          v.vUv.assign(corner);
          v.vSoftness.assign(softness);

          const pxSize = float(0.0).toVar();
          const physRatio = float(1.0).toVar();
          If(chart, () => {
            // Chart-mode flat-disc sizing: pixel diameter spreads linearly
            // between [Max, Min] across [uChartMagBright, uLimitMag].
            // `appMag` already carries the variability shift, so a variable
            // breathes in pixel space the way Sky Atlas's glyph implies.
            // physRatio 1 forces the fragment's chart disc path; chart is
            // non-photometric and returns before the fragment touches
            // luminance, so both peaks stay at zero.
            const chartT = clamp(
              appMag.sub(u.uChartMagBright)
                .div(max(u.uLimitMag.sub(u.uChartMagBright), 0.001)),
              0.0, 1.0);
            pxSize.assign(mix(u.uChartDiscMaxPx, u.uChartDiscMinPx, chartT));
            v.vPeakL.assign(0.0);
            v.vFluxPeakL.assign(0.0);
          }).Else(() => {
            const dMEff = perceptualDmEffTsl(appMag, u.uLimitMag, u.uSizeSpan, u.uSizeKnee);
            const appSize = perceptualAppSizePxTsl(dMEff, u.uSizeMin, u.uSizeMax, u.uSizeSpan);

            const rPc = pow(10.0, stat('iLogRadius')).mul(u.uRSunPc);
            const angularToPx = u.uViewport.y.div(max(u.uFovYRad, 1e-9));
            const physSizeRaw = atan(rPc.mul(radiusFactor).div(dPc)).mul(2.0).mul(angularToPx);
            // The peak takes the UNCLAMPED physical radius (CSS px) — the
            // clamp below is display-only (../../star-pipeline/README.md
            // § Physical-luminance emission).
            const peakL = pointSourcePeakTsl(
              u.uExposure, appMag, physSizeRaw.mul(0.5)).toVar();
            v.vPeakL.assign(peakL);

            const physSize = min(
              physSizeRaw, u.uMaxPhysFrac.mul(min(u.uViewport.x, u.uViewport.y)));
            pxSize.assign(max(appSize, physSize));

            // The size the pass split routes on. Only the glow pipeline
            // folds the eclipse dim into appMag, and a dim SHRINKS appSize,
            // which RAISES physSize / max(appSize, physSize). Let the dim
            // carry a star just under the split over it and glow discards it
            // as disc-owned while disc, reading the undimmed appMag, still
            // discards it as glow-owned — drawn by neither pipeline. Route on
            // the undimmed size so all three agree, matching the GLSL twin
            // and the CPU pick mirror
            // (../../camera/controls/star-pick-visibility-pure.ts).
            const routeAppSize = pass === STAR_PASS_GLOW
              ? perceptualAppSizePxTsl(
                perceptualDmEffTsl(
                  appMag.sub(eclipseDimMag), u.uLimitMag, u.uSizeSpan, u.uSizeKnee),
                u.uSizeMin, u.uSizeMax, u.uSizeSpan)
              : appSize;
            physRatio.assign(
              clamp(physSize.div(max(max(routeAppSize, physSize), 0.001)), 0.0, 1.0));

            // Kernel collapse — must precede the flux renorm below so it
            // divides the collapsed footprint.
            // ../../star-pipeline/collapse/README.md.
            const tap = float(1.0).sub(smoothstep(
              u.uThresholdMag, u.uThresholdMag.add(SOFT_TAPER_MARGIN_MAG), appMag));
            If(physRatio.lessThan(PHYS_RATIO_THRESHOLD)
              .and(peakL.mul(tap).mul(tap).lessThan(GLOW_COLLAPSE_FLOOR_L)), () => {
              pxSize.assign(u.uSizeMin);
            });

            // The statistic's flux channel: the same kernel divided by its own
            // area integral so its frame integral returns the star's true flux.
            // pxSize is CSS pixels, which is what keeps the frame mean
            // devicePixelRatio-independent
            // (../../hdr/exposure/reduction/README.md § Pixel units).
            v.vFluxPeakL.assign(kernelFluxPeakTsl(
              u.uExposure, appMag, pxSize,
              perceptualDiscFluxIntegralTsl(perceptualDiscExponentTsl(
                softness, physRatio, u.uDistNMin, u.uDistNMax,
                u.uLumBiasMin, u.uLumBiasMax))));
          });
          v.vPhysRatio.assign(physRatio);
          v.vAaWidth.assign(float(1.0).div(max(pxSize, 0.5)));

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

          if (pass === STAR_PASS_CORE_MASK && isMember !== null) {
            // The member stamp, moved from the GLSL fragment stage
            // (gl_FragDepth = 0.0) to the vertex: per-instance, so the whole
            // quad pins to the near end of the reversed-z clip convention and
            // fixed-function depth writes the nearest value — no fragment
            // depth output, which is what keeps early-z alive
            // (../README.md § Early-z). The mirror's own mask never pins:
            // its stamp IS the member's true bracket depth.
            If(isMember, () => {
              clipOut.assign(vec4(
                clipOut.x, clipOut.y,
                clipOut.w.mul(1 - CORE_MASK_NEAR_PIN_EPS), clipOut.w));
            });
          }
        });
      });
    });
    return clipOut;
  })();
}
