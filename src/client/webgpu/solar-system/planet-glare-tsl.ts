// planet.vert.glsl / planet.frag.glsl on the TSL path: the reflected-glare
// billboard over ./planet-glare-geometry.ts's packed layout. Physics:
// ../../solar-system/planets/glare/README.md.

import {
  Discard, Fn, If, acos, atan, clamp, cos, dot, exp, float, instanceIndex, int,
  length, log, max, mix, select, sin, smoothstep, varyingProperty, vec2, vec3,
  vec4, cameraProjectionMatrix, modelViewMatrix,
} from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { SOFT_TAPER_MARGIN_MAG } from '../../solar-system/perceptual-magnitude';
import { kernelFluxPeakTsl, maskedStatisticTexelTsl, pointSourcePeakTsl } from '../emission-tsl';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import {
  perceptualAppSizePxTsl, perceptualDiscExponentTsl,
  perceptualDiscFluxIntegralTsl, perceptualDiscProfileTsl, perceptualDmEffTsl,
} from '../perceptual-disc-tsl';
import type { SharedUniformNodes } from '../shared-uniform-nodes';
import { attrVec2, attrVec3, attrVec4 } from '../tsl-shim';
import { tonemapUnditheredTsl } from '../tonemap-tsl';
import type { GlareUniformNodes } from './planet-glare-uniforms';

type NF = Node<'float'>;

const LOG10 = Math.LN10;
const DEG_PER_RAD = 180 / Math.PI;

/** Phase-curve polynomial in α-degrees. Degree 7 — c7 rides the body
 *  pack's `.w`, and is zero for every planet but Mercury. */
const phaseDvTsl = /* @__PURE__ */ Fn(
  ([a, b, c7, aDeg]: [Node<'vec4'>, Node<'vec4'>, NF, NF]) => a.x.add(aDeg.mul(
    a.y.add(aDeg.mul(a.z.add(aDeg.mul(a.w.add(aDeg.mul(
      b.x.add(aDeg.mul(b.y.add(aDeg.mul(b.z.add(aDeg.mul(c7)))))))))))))),
);

const lambertPhiTsl = /* @__PURE__ */ Fn(
  ([alpha]: [NF]) => sin(alpha).add(float(Math.PI).sub(alpha).mul(cos(alpha)))
    .div(Math.PI),
);

export function buildGlareVaryings() {
  return {
    vColor: varyingProperty('vec3', 'vGlareColor'),
    vUv: varyingProperty('vec2', 'vGlareUv'),
    vAppMag: varyingProperty('float', 'vGlareAppMag'),
    vSoftness: varyingProperty('float', 'vGlareSoftness'),
    vPeakL: varyingProperty('float', 'vGlarePeakL'),
    vFluxPeakL: varyingProperty('float', 'vGlareFluxPeakL'),
    vAaWidth: varyingProperty('float', 'vGlareAaWidth'),
  };
}

export type GlareVaryings = ReturnType<typeof buildGlareVaryings>;

/**
 * The billboard's vertex stage. `localPass` selects the mirror variant:
 * the main-pass material collapses instances INSIDE the active cluster's
 * slot range and the mirror collapses those outside it, off one shared
 * `uLocalPassRange` (`../../local-depth/README.md`).
 */
function buildGlareVertexNode(
  u: SharedUniformNodes,
  g: GlareUniformNodes,
  v: GlareVaryings,
  localPass: boolean,
): Node {
  return Fn(() => {
    const corner = attrVec2('aCorner');
    const colourSolidity = attrVec4('iColourSolidity');
    const body = attrVec4('iBody');
    const dyn = attrVec2('iDyn');
    const ringFlux = dyn.x;
    const eclipseDim = dyn.y;
    const self = int(instanceIndex);

    const clipOut = vec4(2.0, 2.0, 2.0, 1.0).toVar();

    // View-space positions (frame-independent — host and planet both move
    // through the same modelViewMatrix). Distances are in pc because there
    // is no scale baked into modelMatrix.
    const hostLocal = attrVec3('iHostLocalPos');
    const planetView = modelViewMatrix
      .mul(vec4(hostLocal.add(attrVec3('iLocalRel')), 1.0)).toVar();
    const hostView = modelViewMatrix.mul(vec4(hostLocal, 1.0)).toVar();

    // Degenerate geometry (viewer exactly at the planet, or planet exactly
    // at the host) kills the quad. The viewer→host distance is deliberately
    // NOT tested — observe mode parks the camera exactly at the host, and
    // its planets must render.
    const dVp = length(planetView.xyz).toVar();
    const dHp = length(planetView.xyz.sub(hostView.xyz)).toVar();
    const inRange = self.greaterThanEqual(g.uLocalPassRange.x)
      .and(self.lessThan(g.uLocalPassRange.x.add(g.uLocalPassRange.y)));
    const passSuppressed = localPass ? inRange.not() : inRange;
    const alive = passSuppressed.not()
      .and(self.notEqual(g.uHideIdx))
      .and(dVp.greaterThan(0.0))
      .and(dHp.greaterThan(0.0))
      // Exactly 0 is totality: the quad collapses, because a floored
      // residual is still visible on a bright close body and the
      // planet-scale depth buffer cannot hide it.
      .and(eclipseDim.greaterThan(0.0));

    If(alive, () => {
      // Phase angle α = ∠(viewer → planet → host).
      const vphHat = planetView.xyz.negate().normalize();
      const hphHat = hostView.xyz.sub(planetView.xyz).normalize().toVar();
      const cosA = clamp(dot(vphHat, hphHat), -1.0, 1.0).toVar();
      const alpha = acos(cosA).toVar();
      const alphaDeg = alpha.mul(DEG_PER_RAD).toVar();
      const alphaMaxDeg = attrVec4('iPhaseCoefsB').w.toVar();
      const coefA = attrVec4('iPhaseCoefsA');
      const coefB = attrVec4('iPhaseCoefsB');
      const c7 = body.w;

      // The published empirical polynomial where α sits inside its
      // validity range; anchor-scaled Lambert past the bound, which keeps
      // each body's own character (Mars's faster-than-Lambert darkening)
      // extending out instead of snapping to a uniform sphere; pure
      // Lambert where alphaMaxDeg = 0 is the "no curve" sentinel. CPU
      // mirror: ../../solar-system/phase-function.ts.
      const phi = lambertPhiTsl(alpha).toVar();
      If(alphaMaxDeg.greaterThan(0.0), () => {
        If(alphaDeg.lessThanEqual(alphaMaxDeg), () => {
          phi.assign(exp(phaseDvTsl(coefA, coefB, c7, alphaDeg).mul(-0.4 * LOG10)));
        }).Else(() => {
          const boundaryFlux = exp(
            phaseDvTsl(coefA, coefB, c7, alphaMaxDeg).mul(-0.4 * LOG10));
          const alphaMaxRad = alphaMaxDeg.mul(Math.PI / 180);
          phi.assign(lambertPhiTsl(alpha)
            .mul(boundaryFlux.div(lambertPhiTsl(alphaMaxRad))));
        });
      });
      // A ring system's share of the unresolved flux ADDS: both terms are
      // fluxes against the globe at α = 0, and a ratio would be 0/0 as
      // α → 180° (../../solar-system/planets/rings/README.md).
      phi.addAssign(ringFlux);

      // Reflected-light apparent magnitude. The viewer→host distance
      // cancels out of the physical formula and MUST NOT appear: observe
      // mode parks the camera exactly at the host, where any d_vh term is
      // log(0). CPU mirror: perceptual-magnitude.ts.
      const mHostAtPlanet = body.z.add(log(dHp).div(LOG10).sub(1.0).mul(5.0));
      const radRatio = body.x.div(dVp);
      const reflFactor = body.y.mul(radRatio).mul(radRatio).mul(max(phi, 0.0));
      const appMag = mHostAtPlanet
        .sub(log(max(reflFactor, 1e-30)).mul(2.5 / LOG10)).toVar();

      // Population cull — the star pipeline's uCullMag, so the glare fades
      // out on the fragment taper rather than on a population edge.
      If(appMag.lessThanEqual(u.uCullMag), () => {
        // Solidity → softness: rocky (1) reads crisp like a white dwarf,
        // gas-giant (0) fuzzy like a hypergiant. Same shaping the star
        // pipeline uses for lumClass.
        const softness = clamp(float(1.0).sub(colourSolidity.w), 0.0, 1.0).toVar();
        const angularToPx = u.uViewport.y.div(max(u.uFovYRad, 1e-9));
        const physSize = atan(body.x.div(dVp)).mul(2.0).mul(angularToPx).toVar();

        const pxSize = float(0.0).toVar();
        const photoOffsetPx = vec2(0.0).toVar();
        If(u.uMonochrome.greaterThan(0.5), () => {
          // Chart-mode flat-disc sizing — the star vertex shader's chart
          // branch verbatim. The frag returns before it touches luminance,
          // so both peaks stay at the zero they were declared with.
          const chartT = clamp(
            appMag.sub(u.uChartMagBright)
              .div(max(u.uLimitMag.sub(u.uChartMagBright), 0.001)),
            0.0, 1.0);
          pxSize.assign(mix(u.uChartDiscMaxPx, u.uChartDiscMinPx, chartT));
        }).Else(() => {
          const dMEff = perceptualDmEffTsl(
            appMag, u.uLimitMag, u.uSizeSpan, u.uSizeKnee);
          pxSize.assign(perceptualAppSizePxTsl(
            dMEff, u.uSizeMin, u.uSizeMax, u.uSizeSpan));
          // Emitted luminance in the scene-wide unit. The radius is the
          // body's TRUE angular radius in CSS px — unclamped, and the same
          // quantity the mesh anchors its surface brightness on, which is
          // what makes the resolve step continuous.
          v.vPeakL.assign(pointSourcePeakTsl(
            u.uExposure, appMag, physSize.mul(0.5)).mul(eclipseDim));
          // The statistic's flux channel. The frag shapes the kernel at
          // physRatio 0, so the exponent is uDistNMin alone.
          v.vFluxPeakL.assign(kernelFluxPeakTsl(
            u.uExposure, appMag, pxSize,
            perceptualDiscFluxIntegralTsl(perceptualDiscExponentTsl(
              softness, 0.0, u.uDistNMin, u.uDistNMin,
              u.uLumBiasMin, u.uLumBiasMax))).mul(eclipseDim));

          // Photocentre shift toward the lit limb on a resolved crescent —
          // SHAPE only, scaled by crescentness and resolvedness so a
          // barely-resolved crescent's halo doesn't ring its dark limb and
          // a sub-pixel dot stays centred.
          const illumFrac = cosA.add(1.0).mul(0.5);
          const res = smoothstep(g.uMeshFadePx.x, g.uMeshFadePx.y, physSize);
          const sunDir = hphHat.xy.toVar();
          const sunLen = length(sunDir).toVar();
          If(sunLen.greaterThan(1e-5), () => {
            photoOffsetPx.assign(sunDir.div(sunLen).mul(
              physSize.mul(0.5).mul(g.uGlarePhotocentreShift)
                .mul(float(1.0).sub(illumFrac)).mul(res)));
          });
        });

        // One CSS pixel in vUv units — the chart frag's edge-AA width.
        v.vAaWidth.assign(float(1.0).div(max(pxSize, 0.5)));
        v.vAppMag.assign(appMag);
        v.vColor.assign(colourSolidity.xyz);
        v.vUv.assign(corner);
        v.vSoftness.assign(softness);

        // uPixelRatio cancels out of the GLSL's offset chain; both
        // uViewport and pxSize are CSS px.
        const centreClip = cameraProjectionMatrix
          .mul(vec4(planetView.xyz, 1.0)).toVar();
        const ndcOffset = corner.mul(pxSize).add(photoOffsetPx)
          .div(u.uViewport).mul(2.0);
        clipOut.assign(centreClip.add(vec4(ndcOffset.mul(centreClip.w), 0.0, 0.0)));
      });
    });
    return clipOut;
  })();
}

export function buildPlanetGlareMaterial(
  u: SharedUniformNodes,
  g: GlareUniformNodes,
  gates: EmitterGateNodes,
  localPass: boolean,
): MrtEmitterMaterial {
  const v = buildGlareVaryings();
  const material = new NodeMaterial();
  material.name = localPass ? 'planet-glare-local-tsl' : 'planet-glare-tsl';
  material.vertexNode = buildGlareVertexNode(u, g, v, localPass);

  return finishMrtMaterial(material, () => {
    const r = length(v.vUv).toVar();
    Discard(r.greaterThan(0.5));

    const colour = vec4(0.0).toVar();
    const flux = float(0.0).toVar();
    If(u.uMonochrome.greaterThan(0.5), () => {
      // Chart mode: flat hard-edged ink discs, star.frag's mono branch.
      // The single glare material carries it — no phase glare on paper.
      Discard(v.vAppMag.greaterThan(u.uLimitMag));
      const aa = max(v.vAaWidth, 1e-3);
      const disc = float(1.0).sub(smoothstep(float(0.5).sub(aa), 0.5, r)).toVar();
      Discard(disc.lessThanEqual(0.0));
      colour.assign(vec4(vec3(float(1.0).sub(disc)), 1.0));
    }).Else(() => {
      // Reflected glare — additive, always the fuzzy point-glow profile
      // (physRatio 0 ⇒ Gaussian n), identical to the star glow pass: a
      // planet reads as a star of its magnitude. The tap fades emitted
      // luminance to zero across the just-visible threshold band.
      const n = perceptualDiscExponentTsl(
        v.vSoftness, 0.0, u.uDistNMin, u.uDistNMax, u.uLumBiasMin, u.uLumBiasMax);
      const glow = perceptualDiscProfileTsl(
        r, n, u.uVisibleThreshold, u.uVisibleK).toVar();
      glow.mulAssign(float(1.0).sub(smoothstep(
        u.uThresholdMag, u.uThresholdMag.add(SOFT_TAPER_MARGIN_MAG), v.vAppMag)));
      Discard(glow.lessThanEqual(0.0));
      // Alpha stays the kernel value, exactly as the star glow pass does
      // it: AdditiveBlending multiplies rgb by it, which is what gives the
      // pass its squared falloff. Undithered — glare quads overlap each
      // other and the star field.
      const emitted = v.vColor.mul(v.vPeakL.mul(glow)).toVar();
      flux.assign(v.vFluxPeakL.mul(glow));
      colour.assign(vec4(
        select(
          u.uHdrTarget.greaterThan(0.5),
          emitted,
          tonemapUnditheredTsl(emitted, u.uWhitePoint, u.uHighlightDesat)),
        glow));
    });

    // Alpha 1 on the statistic attachment: one blend equation runs over
    // both, so the additive pass's SrcAlpha factor would scale the flux
    // channel a second time and its integral would come out short.
    return {
      colour,
      statistic: maskedStatisticTexelTsl(gates.statisticWrites, flux, 0.0, 1.0),
      diffuse: vec4(0.0),
    };
  });
}
