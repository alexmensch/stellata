// TSL port of the star shader pair — four depth-honest pipelines per
// ../star-pipeline/README.md § Early-z; structure notes in ./README.md.
// TSL has no value-carrying early return, hence the nested If blocks.

import * as THREE from 'three/webgpu';
import {
  Continue, Discard, Fn, If, Loop,
  any, atan, attribute, cameraPosition, cameraProjectionMatrix, clamp, cos,
  distance, dot, exp, float, fract, greaterThan, instanceIndex, int,
  length, lessThan, log, log2, max, min, mix, modelViewMatrix, pow, select,
  smoothstep, sqrt, step, texture, texture3D, uint, varyingProperty,
  vec2, vec3, vec4,
} from 'three/tsl';
import {
  BV_MAX, BV_MIN, LOG10, LUMA_B, LUMA_G, LUMA_R, LUMA_CEIL,
  MAG_PER_LOG2, PASS_CORE_MASK, PASS_DISC_CORE, PASS_DISC_HALO, PASS_GLOW,
  PHYS_RATIO_THRESHOLD, PI, R_V, TOE_CURVATURE, TOE_KNEE, DUST_STEPS,
  applyPassState, passName,
  type SpikeUniforms, type StarPass,
} from './star-common';

type NF = THREE.Node<'float'>;
type N2 = THREE.Node<'vec2'>;
type N3 = THREE.Node<'vec3'>;
type N4 = THREE.Node<'vec4'>;

const attr2 = (name: string) => attribute(name, 'vec2') as unknown as N2;
const attr4 = (name: string) => attribute(name, 'vec4') as unknown as N4;

const LUMA_WEIGHTS = vec3(LUMA_R, LUMA_G, LUMA_B);

const ballesterosBvFromTeff = /* @__PURE__ */ Fn(([teff]: [NF]) => {
  const k = teff.div(4600.0);
  const disc = sqrt(k.mul(k).mul(1.1664).add(4.0));
  const u = float(2.0).sub(k.mul(2.32)).add(disc).div(k.mul(2.0));
  return u.div(0.92);
});

const perceptualDmEff = /* @__PURE__ */ Fn(([appMag, limitMag, sizeSpan, sizeKnee]: [NF, NF, NF, NF]) => {
  const dM = limitMag.sub(appMag);
  const over = dM.sub(sizeSpan);
  const soft = sizeSpan.add(sizeKnee.mul(over).div(max(sizeKnee.add(over), 1e-6)));
  return select(dM.lessThanEqual(sizeSpan), max(dM, 0.0), soft);
});

const perceptualDiscExponent = /* @__PURE__ */ Fn(
  ([softness, physRatio, distNMin, distNMax, lumBiasMin, lumBiasMax]: [NF, NF, NF, NF, NF, NF]) => {
    const distN = mix(distNMin, distNMax, smoothstep(0.0, 0.5, physRatio));
    const lumBias = mix(lumBiasMin, lumBiasMax, softness);
    return distN.mul(lumBias);
  },
);

const perceptualDiscProfile = /* @__PURE__ */ Fn(
  ([r, n, visibleThreshold, visibleK]: [NF, NF, NF, NF]) => {
    const raw = exp(visibleK.negate().mul(pow(r.mul(2.0), n)));
    return max(0.0, raw.sub(visibleThreshold).div(float(1.0).sub(visibleThreshold)));
  },
);

const pointSourcePeak = /* @__PURE__ */ Fn(([exposure, appMag, physRadiusPx]: [NF, NF, NF]) => {
  const flux = exposure.mul(pow(10.0, appMag.mul(-0.4)));
  const spread = max(1.0, physRadiusPx.mul(physRadiusPx).mul(PI));
  return min(flux.div(spread), LUMA_CEIL);
});

const srgbEncode = /* @__PURE__ */ Fn(([c]: [N3]) => {
  const v = clamp(c, vec3(0.0), vec3(1.0));
  // pow / mix are vec3-capable at runtime; @types/three pins them to
  // FloatOrNumber, hence the casts.
  const encoded = (pow(v as unknown as NF, vec3(1.0 / 2.4) as unknown as NF) as unknown as N3)
    .mul(1.055).sub(0.055);
  return mix(
    v.mul(12.92) as unknown as NF,
    encoded as unknown as NF,
    step(vec3(0.0031308), v) as unknown as NF,
  ) as unknown as N3;
});

const tonemapUndithered = /* @__PURE__ */ Fn(([hdr, whitePoint, desat]: [N3, NF, NF]) => {
  const y = dot(hdr, LUMA_WEIGHTS);
  const ySafe = max(y, 1e-9);
  const magsUnder = log2(float(TOE_KNEE).div(ySafe)).mul(MAG_PER_LOG2);
  const toe = select(
    y.greaterThanEqual(TOE_KNEE),
    y,
    pow(ySafe.div(TOE_KNEE), magsUnder.mul(TOE_CURVATURE).add(1.0)).mul(TOE_KNEE),
  );
  const yd = toe.mul(toe.div(whitePoint.mul(whitePoint)).add(1.0)).div(toe.add(1.0));
  const white = float(1.0).sub(exp(desat.negate().mul(max(y.div(whitePoint).sub(1.0), 0.0))));
  const mapped = mix(hdr.mul(yd.div(ySafe)), vec3(yd), white) as unknown as N3;
  return select(y.lessThanEqual(0.0), vec3(0.0), srgbEncode(mapped));
});

/** Builds one material for one pass. Fresh varying nodes per material —
 *  each program pairs its own vertex/fragment stages. */
export function buildStarMaterialTSL(
  u: SpikeUniforms,
  dustTex: THREE.Data3DTexture,
  lutTex: THREE.DataTexture,
  pass: StarPass,
): THREE.NodeMaterial {
  const vAppMag = varyingProperty('float', 'vAppMag');
  const vColor = varyingProperty('vec3', 'vColor');
  const vUv = varyingProperty('vec2', 'vUv');
  const vPhysRatio = varyingProperty('float', 'vPhysRatio');
  const vSoftness = varyingProperty('float', 'vSoftness');
  const vPeakL = varyingProperty('float', 'vPeakL');

  const dustMarchAV = Fn(([absFrom, absTo]: [N3, N3]) => {
    const delta = absTo.sub(absFrom).toVar();
    const lenPc = length(delta);
    const accum = float(0.0).toVar();
    const invRange = float(0.5).div(u.uDustBoundsPc);
    Loop(DUST_STEPS, ({ i }) => {
      const t = float(i as unknown as NF).add(0.5).div(DUST_STEPS);
      const uvw = absFrom.add(delta.mul(t)).mul(invRange).add(0.5).toVar();
      If(
        any(lessThan(uvw, vec3(0.0))).or(any(greaterThan(uvw, vec3(1.0)))),
        () => { Continue(); },
      );
      const encoded = texture3D(dustTex, uvw as unknown as N3).r;
      accum.addAssign(u.uDustDensityMin.mul(exp(encoded.mul(u.uDustLogRatio))));
    });
    const stepPc = lenPc.div(DUST_STEPS);
    return select(
      lenPc.lessThan(0.001),
      float(0.0),
      accum.mul(stepPc).mul(u.uDustAvPerDensityPc),
    );
  });

  const ciToColor = Fn(([bv]: [NF]) => {
    const t = clamp(bv.sub(BV_MIN).div(BV_MAX - BV_MIN), 0.0, 1.0);
    const chroma = texture(lutTex, vec2(t, 0.5)).rgb;
    return chroma.div(max(dot(chroma, LUMA_WEIGHTS), 1e-6));
  });

  const vertexNode = Fn(() => {
    const corner = attr2('aCorner');
    const posDist = attr4('iPosDist');
    const phot = attr4('iPhot');
    const varA = attr4('iVar');
    const misc = attr4('iMisc');
    const self = int(instanceIndex);

    const clipOut = vec4(2.0, 2.0, 2.0, 1.0).toVar();

    const isMember = self.equal(u.uMemberIdx.x)
      .or(self.equal(u.uMemberIdx.y))
      .or(self.equal(u.uMemberIdx.z))
      .or(self.equal(u.uMemberIdx.w));
    const suppressed = pass === PASS_CORE_MASK
      ? self.equal(u.uHideFocusIdx)
      : self.equal(u.uHideFocusIdx).or(isMember);

    If(suppressed.not(), () => {
      const worldPos = posDist.xyz;
      const dPc = max(distance(worldPos, cameraPosition), 1e-30).toVar();
      const appMag = phot.x.add(log(dPc).div(LOG10).sub(1.0).mul(5.0)).toVar();

      const radiusFactor = float(1.0).toVar();
      const ciMod = float(0.0).toVar();
      If(varA.x.greaterThan(0.0).and(varA.y.greaterThan(0.0)).and(misc.z.lessThan(0.5)), () => {
        const minModelDays = u.uModelDaysPerRealSec.mul(u.uMinPeriodSec);
        const periodEff = max(varA.x, minModelDays);
        const phase = fract(u.uModelDays.div(periodEff));
        const c = cos(phase.mul(2.0 * PI));
        appMag.addAssign(varA.y.mul(-0.5).mul(c));
        radiusFactor.assign(pow(varA.z, c.mul(-0.5)));
        ciMod.assign(varA.w.mul(-0.5).mul(c));
      });

      const spectOk = u.uSpectMask.bitAnd(uint(1).shiftLeft(uint(misc.x))).notEqual(uint(0));
      const distOk = posDist.w.greaterThanEqual(u.uMinDistSol)
        .and(posDist.w.lessThanEqual(u.uMaxDistSol));
      const magOkPrelim = appMag.lessThanEqual(u.uCullMag);

      If(spectOk.and(distOk).and(magOkPrelim), () => {
        const absorbAV = float(0.0).toVar();
        If(u.uDustStrength.greaterThan(0.0), () => {
          absorbAV.assign(
            dustMarchAV(cameraPosition as unknown as N3, worldPos as unknown as N3)
              .mul(u.uDustStrength));
        });
        appMag.addAssign(absorbAV);

        If(appMag.lessThanEqual(u.uCullMag), () => {
          const intrinsicBv = select(
            phot.z.greaterThan(0.0), ballesterosBvFromTeff(phot.z), phot.y);
          const effectiveCi = intrinsicBv.add(absorbAV.div(R_V)).add(ciMod);

          const lumClass = select(misc.y.lessThan(100.0), misc.y, 2.0);
          const softness = clamp(lumClass.div(9.0), 0.0, 1.0);

          vAppMag.assign(appMag);
          vColor.assign(ciToColor(effectiveCi));
          vUv.assign(corner);
          vSoftness.assign(softness);

          const dMEff = perceptualDmEff(appMag, u.uLimitMag, u.uSizeSpan, u.uSizeKnee);
          const appSize = mix(u.uSizeMin, u.uSizeMax, sqrt(dMEff.div(max(u.uSizeSpan, 0.001))));

          const rPc = pow(10.0, phot.w).mul(u.uRSunPc);
          const angularToPx = u.uViewport.y.div(max(u.uFovYRad, 1e-9));
          const physSizeRaw = atan(rPc.mul(radiusFactor).div(dPc)).mul(2.0).mul(angularToPx);
          vPeakL.assign(pointSourcePeak(u.uExposure, appMag, physSizeRaw.mul(0.5)));

          const physSize = min(
            physSizeRaw, u.uMaxPhysFrac.mul(min(u.uViewport.x, u.uViewport.y)));
          const pxSize = max(appSize, physSize);
          vPhysRatio.assign(clamp(physSize.div(max(pxSize, 0.001)), 0.0, 1.0));

          const centreClip = cameraProjectionMatrix
            .mul(modelViewMatrix)
            .mul(vec4(worldPos, 1.0))
            .toVar();
          const ndcOffset = corner.mul(pxSize).div(u.uViewport).mul(2.0);
          clipOut.assign(centreClip.add(vec4(ndcOffset.mul(centreClip.w), 0.0, 0.0)));

          if (pass === PASS_CORE_MASK) {
            // D3: a member's stamp pins to the NEAR end of the reversed-z
            // convention (depth 1) in the vertex stage — no frag-depth write.
            If(isMember, () => { clipOut.z.assign(clipOut.w.mul(0.999999)); });
          }
        });
      });
    });
    return clipOut;
  });

  const starEmission = Fn(([glow]: [NF]) => {
    const emitted = vColor.mul(vPeakL.mul(glow)) as unknown as N3;
    return vec4(tonemapUndithered(emitted, u.uWhitePoint, u.uHighlightDesat), glow);
  });

  const fragmentNode = Fn(() => {
    const r = length(vUv);
    Discard(r.greaterThan(0.5));

    const n = perceptualDiscExponent(
      vSoftness, vPhysRatio, u.uDistNMin, u.uDistNMax, u.uLumBiasMin, u.uLumBiasMax);
    const glow = perceptualDiscProfile(r, n, u.uVisibleThreshold, u.uVisibleK).toVar();

    if (pass === PASS_GLOW) {
      Discard(vPhysRatio.greaterThanEqual(PHYS_RATIO_THRESHOLD));
      const tap = float(1.0).sub(smoothstep(u.uThresholdMag, u.uThresholdMag.add(0.5), vAppMag));
      glow.mulAssign(tap);
      return starEmission(glow);
    }
    Discard(vPhysRatio.lessThan(PHYS_RATIO_THRESHOLD));
    Discard(vAppMag.greaterThan(u.uThresholdMag));
    if (pass === PASS_DISC_HALO) {
      Discard(glow.greaterThanEqual(u.uCoreThreshold));
      Discard(glow.lessThan(u.uDiscardThreshold));
      return starEmission(glow);
    }
    Discard(glow.lessThan(u.uCoreThreshold));
    if (pass === PASS_CORE_MASK) return vec4(0.0);
    return starEmission(glow);
  });

  const material = new THREE.NodeMaterial();
  material.name = `star-tsl-${passName(pass)}`;
  material.vertexNode = vertexNode();
  material.fragmentNode = fragmentNode();
  applyPassState(material, pass);
  return material;
}

export function buildStarMaterialsTSL(
  u: SpikeUniforms,
  dustTex: THREE.Data3DTexture,
  lutTex: THREE.DataTexture,
): Record<StarPass, THREE.NodeMaterial> {
  return {
    [PASS_GLOW]: buildStarMaterialTSL(u, dustTex, lutTex, PASS_GLOW),
    [PASS_DISC_CORE]: buildStarMaterialTSL(u, dustTex, lutTex, PASS_DISC_CORE),
    [PASS_DISC_HALO]: buildStarMaterialTSL(u, dustTex, lutTex, PASS_DISC_HALO),
    [PASS_CORE_MASK]: buildStarMaterialTSL(u, dustTex, lutTex, PASS_CORE_MASK),
  };
}
