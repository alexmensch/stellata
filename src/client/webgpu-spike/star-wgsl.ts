// Raw-WGSL port of the star shader pair — same four depth-honest pipelines
// as star-tsl.ts, with all logic in WGSL strings and TSL binding only I/O.
// Varyings leave the vertex fn via ptr<function> out-params (./README.md).

import * as THREE from 'three/webgpu';
import {
  Fn, attribute, cameraPosition, cameraProjectionMatrix, float, instanceIndex,
  int, modelViewMatrix, sampler, texture, texture3D, varyingProperty,
  vec2, vec3, wgsl, wgslFn,
} from 'three/tsl';
import {
  BV_MAX, BV_MIN, DUST_STEPS, LOG10, LUMA_B, LUMA_G, LUMA_R, LUMA_CEIL,
  MAG_PER_LOG2, PASS_CORE_MASK, PASS_DISC_CORE, PASS_DISC_HALO, PASS_GLOW,
  PHYS_RATIO_THRESHOLD, PI, R_V, TOE_CURVATURE, TOE_KNEE,
  applyPassState, passName,
  type SpikeUniforms, type StarPass,
} from './star-common';

const helpersWgsl = wgsl(/* wgsl */ `
fn spikeBallesterosBv(teff: f32) -> f32 {
  let k = teff / 4600.0;
  let disc = sqrt(4.0 + 1.1664 * k * k);
  let u = (2.0 - 2.32 * k + disc) / (2.0 * k);
  return u / 0.92;
}

fn spikeDmEff(appMag: f32, limitMag: f32, sizeSpan: f32, sizeKnee: f32) -> f32 {
  let dM = limitMag - appMag;
  if (dM <= sizeSpan) { return max(dM, 0.0); }
  let over = dM - sizeSpan;
  return sizeSpan + sizeKnee * over / max(sizeKnee + over, 1e-6);
}

fn spikeDiscExponent(
  softness: f32, physRatio: f32,
  distNMin: f32, distNMax: f32, lumBiasMin: f32, lumBiasMax: f32,
) -> f32 {
  let distN = mix(distNMin, distNMax, smoothstep(0.0, 0.5, physRatio));
  let lumBias = mix(lumBiasMin, lumBiasMax, softness);
  return distN * lumBias;
}

fn spikeDiscProfile(r: f32, n: f32, visibleThreshold: f32, visibleK: f32) -> f32 {
  let raw = exp(-visibleK * pow(2.0 * r, n));
  return max(0.0, (raw - visibleThreshold) / (1.0 - visibleThreshold));
}

fn spikePointSourcePeak(exposure: f32, appMag: f32, physRadiusPx: f32) -> f32 {
  let flux = exposure * pow(10.0, -0.4 * appMag);
  let spread = max(1.0, ${PI} * physRadiusPx * physRadiusPx);
  return min(flux / spread, ${LUMA_CEIL});
}

fn spikeDustMarchAV(
  absFrom: vec3f, absTo: vec3f,
  boundsPc: f32, densityMin: f32, logRatio: f32, avPerDensityPc: f32,
  dustTex: texture_3d<f32>, dustSamp: sampler,
) -> f32 {
  let delta = absTo - absFrom;
  let lenPc = length(delta);
  if (lenPc < 0.001) { return 0.0; }
  let stepPc = lenPc / ${DUST_STEPS}.0;
  let invRange = 0.5 / boundsPc;
  var accum = 0.0;
  for (var i = 0; i < ${DUST_STEPS}; i++) {
    let t = (f32(i) + 0.5) / ${DUST_STEPS}.0;
    let uvw = (absFrom + delta * t) * invRange + 0.5;
    if (any(uvw < vec3f(0.0)) || any(uvw > vec3f(1.0))) { continue; }
    let encoded = textureSampleLevel(dustTex, dustSamp, uvw, 0.0).r;
    accum += densityMin * exp(encoded * logRatio);
  }
  return accum * stepPc * avPerDensityPc;
}

fn spikeSrgbEncode(c: vec3f) -> vec3f {
  let v = clamp(c, vec3f(0.0), vec3f(1.0));
  return mix(
    v * 12.92,
    1.055 * pow(v, vec3f(1.0 / 2.4)) - 0.055,
    step(vec3f(0.0031308), v),
  );
}

fn spikeTonemapUndithered(hdr: vec3f, whitePoint: f32, desat: f32) -> vec3f {
  let y = dot(hdr, vec3f(${LUMA_R}, ${LUMA_G}, ${LUMA_B}));
  if (y <= 0.0) { return vec3f(0.0); }
  var toe = y;
  if (y < ${TOE_KNEE}) {
    let magsUnder = log2(${TOE_KNEE} / y) * ${MAG_PER_LOG2};
    toe = ${TOE_KNEE} * pow(y / ${TOE_KNEE}, 1.0 + ${TOE_CURVATURE} * magsUnder);
  }
  let yd = toe * (1.0 + toe / (whitePoint * whitePoint)) / (1.0 + toe);
  let white = 1.0 - exp(-desat * max(y / whitePoint - 1.0, 0.0));
  let mapped = mix(hdr * (yd / y), vec3f(yd), white);
  return spikeSrgbEncode(mapped);
}
`);

const starVertexWgsl = wgslFn(/* wgsl */ `
fn spikeStarVertex(
  corner: vec2f,
  posDist: vec4f,
  phot: vec4f,
  varData: vec4f,
  misc: vec4f,
  selfIdx: i32,
  passIdx: i32,
  cameraPos: vec3f,
  projMat: mat4x4f,
  mvMat: mat4x4f,
  exposure: f32,
  limitMag: f32,
  cullMag: f32,
  minDistSol: f32,
  maxDistSol: f32,
  spectMask: u32,
  hideFocusIdx: i32,
  memberIdx: vec4i,
  viewportCss: vec2f,
  fovYRad: f32,
  sizeMin: f32,
  sizeMax: f32,
  sizeSpan: f32,
  sizeKnee: f32,
  maxPhysFrac: f32,
  rSunPc: f32,
  modelDays: f32,
  modelDaysPerRealSec: f32,
  minPeriodSec: f32,
  dustBoundsPc: f32,
  dustDensityMin: f32,
  dustLogRatio: f32,
  dustAvPerDensityPc: f32,
  dustStrength: f32,
  dustTex: texture_3d<f32>,
  dustSamp: sampler,
  lutTex: texture_2d<f32>,
  lutSamp: sampler,
  outAppMag: ptr<function, f32>,
  outColor: ptr<function, vec3f>,
  outUv: ptr<function, vec2f>,
  outPhysRatio: ptr<function, f32>,
  outSoftness: ptr<function, f32>,
  outPeakL: ptr<function, f32>,
) -> vec4f {
  let sentinel = vec4f(2.0, 2.0, 2.0, 1.0);

  let isMember = selfIdx == memberIdx.x || selfIdx == memberIdx.y
    || selfIdx == memberIdx.z || selfIdx == memberIdx.w;
  var suppressed = selfIdx == hideFocusIdx;
  if (passIdx != ${PASS_CORE_MASK}) { suppressed = suppressed || isMember; }
  if (suppressed) { return sentinel; }

  let worldPos = posDist.xyz;
  let dPc = max(distance(worldPos, cameraPos), 1e-30);
  var appMag = phot.x + 5.0 * (log(dPc) / ${LOG10} - 1.0);

  var radiusFactor = 1.0;
  var ciMod = 0.0;
  if (varData.x > 0.0 && varData.y > 0.0 && misc.z < 0.5) {
    let minModelDays = modelDaysPerRealSec * minPeriodSec;
    let periodEff = max(varData.x, minModelDays);
    let phase = fract(modelDays / periodEff);
    let c = cos(${2 * PI} * phase);
    appMag += -0.5 * varData.y * c;
    radiusFactor = pow(varData.z, -0.5 * c);
    ciMod = -0.5 * varData.w * c;
  }

  let spectOk = (spectMask & (1u << u32(misc.x))) != 0u;
  let distOk = posDist.w >= minDistSol && posDist.w <= maxDistSol;
  let magOkPrelim = appMag <= cullMag;
  if (!(spectOk && distOk && magOkPrelim)) { return sentinel; }

  var absorbAV = 0.0;
  if (dustStrength > 0.0) {
    absorbAV = spikeDustMarchAV(
      cameraPos, worldPos,
      dustBoundsPc, dustDensityMin, dustLogRatio, dustAvPerDensityPc,
      dustTex, dustSamp) * dustStrength;
  }
  appMag += absorbAV;

  var intrinsicBv = phot.y;
  if (phot.z > 0.0) { intrinsicBv = spikeBallesterosBv(phot.z); }
  let effectiveCi = intrinsicBv + absorbAV / ${R_V} + ciMod;

  if (appMag > cullMag) { return sentinel; }

  var lumClass = misc.y;
  if (lumClass >= 100.0) { lumClass = 2.0; }
  let softness = clamp(lumClass / 9.0, 0.0, 1.0);

  let t = clamp((effectiveCi - ${BV_MIN}) / ${BV_MAX - BV_MIN}, 0.0, 1.0);
  let chroma = textureSampleLevel(lutTex, lutSamp, vec2f(t, 0.5), 0.0).rgb;
  let color = chroma / max(dot(chroma, vec3f(${LUMA_R}, ${LUMA_G}, ${LUMA_B})), 1e-6);

  let dMEff = spikeDmEff(appMag, limitMag, sizeSpan, sizeKnee);
  let appSize = mix(sizeMin, sizeMax, sqrt(dMEff / max(sizeSpan, 0.001)));

  let rPc = pow(10.0, phot.w) * rSunPc;
  let angularToPx = viewportCss.y / max(fovYRad, 1e-9);
  let physSizeRaw = 2.0 * atan(rPc * radiusFactor / dPc) * angularToPx;
  let peakL = spikePointSourcePeak(exposure, appMag, 0.5 * physSizeRaw);

  let physSize = min(physSizeRaw, maxPhysFrac * min(viewportCss.x, viewportCss.y));
  let pxSize = max(appSize, physSize);

  *outAppMag = appMag;
  *outColor = color;
  *outUv = corner;
  *outPhysRatio = clamp(physSize / max(pxSize, 0.001), 0.0, 1.0);
  *outSoftness = softness;
  *outPeakL = peakL;

  let centreClip = projMat * mvMat * vec4f(worldPos, 1.0);
  let ndcOffset = corner * pxSize / viewportCss * 2.0;
  var clip = centreClip + vec4f(ndcOffset * centreClip.w, 0.0, 0.0);

  if (passIdx == ${PASS_CORE_MASK} && isMember) {
    clip.z = clip.w * 0.999999;
  }
  return clip;
}
`, [helpersWgsl]);

const starFragmentWgsl = wgslFn(/* wgsl */ `
fn spikeStarFragment(
  passIdx: i32,
  vAppMag: f32,
  vColor: vec3f,
  vUv: vec2f,
  vPhysRatio: f32,
  vSoftness: f32,
  vPeakL: f32,
  thresholdMag: f32,
  coreThreshold: f32,
  discardThreshold: f32,
  visibleThreshold: f32,
  visibleK: f32,
  distNMin: f32,
  distNMax: f32,
  lumBiasMin: f32,
  lumBiasMax: f32,
  whitePoint: f32,
  highlightDesat: f32,
) -> vec4f {
  let r = length(vUv);
  if (r > 0.5) { discard; }

  let n = spikeDiscExponent(
    vSoftness, vPhysRatio, distNMin, distNMax, lumBiasMin, lumBiasMax);
  var glow = spikeDiscProfile(r, n, visibleThreshold, visibleK);

  if (passIdx == ${PASS_GLOW}) {
    if (vPhysRatio >= ${PHYS_RATIO_THRESHOLD}) { discard; }
    glow *= 1.0 - smoothstep(thresholdMag, thresholdMag + 0.5, vAppMag);
  } else {
    if (vPhysRatio < ${PHYS_RATIO_THRESHOLD}) { discard; }
    if (vAppMag > thresholdMag) { discard; }
    if (passIdx == ${PASS_DISC_HALO}) {
      if (glow >= coreThreshold) { discard; }
      if (glow < discardThreshold) { discard; }
    } else {
      if (glow < coreThreshold) { discard; }
      if (passIdx == ${PASS_CORE_MASK}) { return vec4f(0.0); }
    }
  }

  let emitted = vColor * (vPeakL * glow);
  return vec4f(spikeTonemapUndithered(emitted, whitePoint, highlightDesat), glow);
}
`, [helpersWgsl]);

export function buildStarMaterialWGSL(
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

  const dustTexNode = texture3D(dustTex);
  const lutTexNode = texture(lutTex);

  const vertexNode = Fn(() => {
    const outAppMag = float(0).toVar();
    const outColor = vec3(0).toVar();
    const outUv = vec2(0).toVar();
    const outPhysRatio = float(0).toVar();
    const outSoftness = float(0).toVar();
    const outPeakL = float(0).toVar();

    const clip = starVertexWgsl({
      corner: attribute('aCorner', 'vec2'),
      posDist: attribute('iPosDist', 'vec4'),
      phot: attribute('iPhot', 'vec4'),
      varData: attribute('iVar', 'vec4'),
      misc: attribute('iMisc', 'vec4'),
      selfIdx: int(instanceIndex),
      passIdx: int(pass),
      cameraPos: cameraPosition,
      projMat: cameraProjectionMatrix,
      mvMat: modelViewMatrix,
      exposure: u.uExposure,
      limitMag: u.uLimitMag,
      cullMag: u.uCullMag,
      minDistSol: u.uMinDistSol,
      maxDistSol: u.uMaxDistSol,
      spectMask: u.uSpectMask,
      hideFocusIdx: u.uHideFocusIdx,
      memberIdx: u.uMemberIdx,
      viewportCss: u.uViewport,
      fovYRad: u.uFovYRad,
      sizeMin: u.uSizeMin,
      sizeMax: u.uSizeMax,
      sizeSpan: u.uSizeSpan,
      sizeKnee: u.uSizeKnee,
      maxPhysFrac: u.uMaxPhysFrac,
      rSunPc: u.uRSunPc,
      modelDays: u.uModelDays,
      modelDaysPerRealSec: u.uModelDaysPerRealSec,
      minPeriodSec: u.uMinPeriodSec,
      dustBoundsPc: u.uDustBoundsPc,
      dustDensityMin: u.uDustDensityMin,
      dustLogRatio: u.uDustLogRatio,
      dustAvPerDensityPc: u.uDustAvPerDensityPc,
      dustStrength: u.uDustStrength,
      dustTex: dustTexNode,
      dustSamp: sampler(dustTexNode),
      lutTex: lutTexNode,
      lutSamp: sampler(lutTexNode),
      outAppMag, outColor, outUv, outPhysRatio, outSoftness, outPeakL,
    }) as unknown as ReturnType<typeof float>;
    const clipVar = clip.toVar();

    vAppMag.assign(outAppMag);
    vColor.assign(outColor);
    vUv.assign(outUv);
    vPhysRatio.assign(outPhysRatio);
    vSoftness.assign(outSoftness);
    vPeakL.assign(outPeakL);
    return clipVar;
  });

  const fragmentNode = Fn(() => starFragmentWgsl({
    passIdx: int(pass),
    vAppMag, vColor, vUv, vPhysRatio, vSoftness, vPeakL,
    thresholdMag: u.uThresholdMag,
    coreThreshold: u.uCoreThreshold,
    discardThreshold: u.uDiscardThreshold,
    visibleThreshold: u.uVisibleThreshold,
    visibleK: u.uVisibleK,
    distNMin: u.uDistNMin,
    distNMax: u.uDistNMax,
    lumBiasMin: u.uLumBiasMin,
    lumBiasMax: u.uLumBiasMax,
    whitePoint: u.uWhitePoint,
    highlightDesat: u.uHighlightDesat,
  }));

  const material = new THREE.NodeMaterial();
  material.name = `star-wgsl-${passName(pass)}`;
  material.vertexNode = vertexNode();
  material.fragmentNode = fragmentNode();
  applyPassState(material, pass);
  return material;
}

export function buildStarMaterialsWGSL(
  u: SpikeUniforms,
  dustTex: THREE.Data3DTexture,
  lutTex: THREE.DataTexture,
): Record<StarPass, THREE.NodeMaterial> {
  return {
    [PASS_GLOW]: buildStarMaterialWGSL(u, dustTex, lutTex, PASS_GLOW),
    [PASS_DISC_CORE]: buildStarMaterialWGSL(u, dustTex, lutTex, PASS_DISC_CORE),
    [PASS_DISC_HALO]: buildStarMaterialWGSL(u, dustTex, lutTex, PASS_DISC_HALO),
    [PASS_CORE_MASK]: buildStarMaterialWGSL(u, dustTex, lutTex, PASS_CORE_MASK),
  };
}
