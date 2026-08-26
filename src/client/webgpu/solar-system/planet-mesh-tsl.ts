// planet-mesh.frag.glsl on the TSL path: equirect sample, terminator, DEM
// relief and its cast shadows, casters, umbral glow, disc airlight.
// Physics: ../../solar-system/planets/README.md; port notes: README.md.

import {
  If, Loop, atan, clamp, cross, dot, float, floor, fract, length, max, min,
  mix, normalView, positionView, screenCoordinate, select, smoothstep, step,
  uv, vec2, vec3, vec4,
} from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { LUMA_CEIL } from '../../hdr/emission/emission-pure';
import { MAX_SHADOW_CASTERS } from '../../solar-system/planets/body-shadow-pure';
import {
  LIMB_EXP, LIMB_FLOOR,
} from '../../solar-system/planets/emission/mesh-surface-pure';
import {
  HORIZON_AZIMUTHS, HORIZON_SIN_RANGE, SKY_VIEW_RANGE,
} from '../../solar-system/planets/surface-relief/surface-relief-pure';
import { maskedStatisticTexelTsl, occluderTexelTsl } from '../emission-tsl';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { lumaWeightsTsl, srgbDecodeTsl, tonemapUnditheredTsl } from '../tonemap-tsl';
import {
  atmosphereRadianceTsl, deflattenedCameraTsl, deflattenedDirTsl,
  scalePolarTsl, shellEntryTsl, skyIrradianceTsl, verticalScatterTauTsl,
} from './atmosphere-scatter-tsl';
import { interleavedGradientNoiseTsl } from '../tsl/jitter-tsl';
import type { PlanetMeshNodes } from './uniform-nodes';

type NF = Node<'float'>;
type N3 = Node<'vec3'>;

/** One raw channel back to the skyline sine it encodes. */
const decodeSin = (raw: NF) => raw.mul(2.0).sub(1.0).mul(HORIZON_SIN_RANGE);

/** One of the eight skyline channels by node-valued index. A component
 *  ladder rather than an indexable array: WGSL can only dynamically index
 *  a `var`, and the two reads here are the whole consumer. */
function encAt(a: Node<'vec4'>, b: Node<'vec4'>, i: NF): NF {
  const v = select(i.lessThan(4.0), a, b);
  const k = i.mod(4.0);
  return select(k.lessThan(1.0), v.x,
    select(k.lessThan(2.0), v.y, select(k.lessThan(3.0), v.z, v.w)));
}

/** Cosine-weighted fraction of the upper hemisphere this patch's own
 *  skyline fills, mean(max(sin h, 0)²) over the stored azimuths. A
 *  skyline BELOW the local horizontal is sky rather than terrain. */
function terrainViewFactor(a: Node<'vec4'>, b: Node<'vec4'>): NF {
  const chans = [a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w];
  let sum: NF = float(0.0);
  for (const raw of chans) {
    const s = max(decodeSin(raw), 0.0);
    sum = sum.add(s.mul(s));
  }
  return sum.div(HORIZON_AZIMUTHS);
}

/** Sine of the skyline's elevation toward (sunE, sunN), between the two
 *  stored azimuths bracketing it. */
function horizonSin(a: Node<'vec4'>, b: Node<'vec4'>, sunE: NF, sunN: NF): NF {
  // atan(0, 0) is undefined and a NaN slot indexes out of range. Both
  // components vanish only with the sun at the local zenith, where every
  // azimuth answers alike; due east is the one the CPU mirror's atan2 picks.
  const degenerate = sunE.equal(0.0).and(sunN.equal(0.0));
  const bearing = select(degenerate, vec2(1.0, 0.0), vec2(sunE, sunN));
  const slot = fract(atan(bearing.y, bearing.x).mul(0.5 / Math.PI)).mul(HORIZON_AZIMUTHS);
  // fract() returns exactly 1.0 for a small enough negative angle, which
  // puts the base one past the last azimuth — the wrap keeps it in range.
  const base = floor(slot);
  const i0 = base.mod(HORIZON_AZIMUTHS);
  const i1 = i0.add(1.0).mod(HORIZON_AZIMUTHS);
  return decodeSin(mix(encAt(a, b, i0), encAt(a, b, i1), slot.sub(base)));
}

/** Equirect tangent frame, exact on the drawn spheroid because a surface
 *  of revolution puts its normal in the meridian plane. Degenerate at the
 *  poles, where `ok` is false and every relief term falls back. */
function tangentFrame(n: N3, pole: N3): { east: N3; north: N3; ok: Node<'bool'> } {
  const e = cross(pole, n);
  const eLen = length(e).toVar();
  const east = e.div(max(eLen, 1e-30)).toVar();
  return { east, north: cross(n, east).toVar(), ok: eLen.greaterThanEqual(1e-6) };
}

export function buildPlanetMeshMaterial(
  u: SharedUniformNodes,
  p: PlanetMeshNodes,
  gates: EmitterGateNodes,
): MrtEmitterMaterial {
  const material = new NodeMaterial();
  material.name = 'planet-mesh-tsl';
  material.transparent = true;
  material.depthWrite = true;
  material.depthTest = true;

  return finishMrtMaterial(material, () => {
    const vUvM = uv();
    const n = normalView;
    const view = positionView.negate().normalize();
    const sunCos = dot(n, p.uSunDirView).toVar();

    const frame = tangentFrame(n, p.uPoleView);
    const hasNormalMap = p.uHasNormalMap.greaterThan(0.5);

    // The perturbed normal reaches this one cosine and nothing else —
    // every other consumer of sunCos below keeps the geometric normal
    // (surface-relief/README.md).
    const nRelief = vec3(n).toVar();
    If(hasNormalMap.and(frame.ok), () => {
      const t = p.uNormalMap.sample(vUvM).rg.mul(2.0).sub(1.0).toVar();
      nRelief.assign(frame.east.mul(t.x).add(frame.north.mul(t.y))
        .add(n.mul(max(float(1.0).sub(dot(t, t)), 0.0).sqrt())).normalize());
    });
    const sunCosRelief = dot(nRelief, p.uSunDirView).toVar();

    // Everything the facet's own slope cannot see over: the terrain around
    // it and the body's own limb. Both branches ride the GEOMETRIC cosine —
    // a horizon is measured against the true local horizontal.
    const horizonGate = float(1.0).toVar();
    const terrainView = float(0.0).toVar();
    If(p.uHasHorizonMap.greaterThan(0.5).and(frame.ok), () => {
      const encA = p.uHorizonA.sample(vUvM).toVar();
      const encB = p.uHorizonB.sample(vUvM).toVar();
      const sinH = horizonSin(
        encA, encB, dot(p.uSunDirView, frame.east), dot(p.uSunDirView, frame.north));
      const pen = max(p.uSunAngRad, 1e-6);
      horizonGate.assign(smoothstep(sinH.sub(pen), sinH.add(pen), sunCos));
      terrainView.assign(select(
        p.uHasSkyView.greaterThan(0.5),
        p.uSkyView.sample(vUvM).r.mul(SKY_VIEW_RANGE),
        terrainViewFactor(encA, encB)));
    }).ElseIf(hasNormalMap, () => {
      horizonGate.assign(smoothstep(
        p.uReliefHorizon.y.negate(), p.uReliefHorizon.x.negate(), sunCos));
    });

    // Lambert cosine away from the terminator; a smoothstep band of
    // half-width uTermSoftness carries twilight past it on atmospheric
    // bodies. The 1e-4 floor keeps the airless w = 0 case a hard cut
    // without a divide-by-zero smoothstep.
    const w = max(p.uTermSoftness, 1e-4).toVar();
    const dayside = smoothstep(w.negate(), w, sunCosRelief)
      .mul(max(sunCosRelief, w)).mul(horizonGate).toVar();

    // Inter-body shadows: attenuate per caster on the ray toward the sun.
    // The penumbra half-width grows as tAlong·uSunAngRad, so shadows are
    // soft-edged and the antumbral case falls out. CPU mirror:
    // body-shadow-pure.ts casterShadowFactor.
    const shadow = float(1.0).toVar();
    Loop(MAX_SHADOW_CASTERS, ({ i }) => {
      If(float(i).lessThan(p.uCasterCount), () => {
        const caster = p.uCasters.element(i);
        const d = caster.xyz.sub(positionView).toVar();
        const tAlong = dot(d, p.uSunDirView).toVar();
        If(tAlong.greaterThan(0.0), () => {
          const missPc = length(d.sub(p.uSunDirView.mul(tAlong)));
          const pen = max(tAlong.mul(p.uSunAngRad), 1e-30);
          shadow.mulAssign(
            smoothstep(caster.w.sub(pen), caster.w.add(pen), missPc));
        });
      });
    });

    // Atmospheric bodies: the scattering governs the limb, so the ad-hoc
    // surface limb-darkening is dropped (it double-darkened the disc edge
    // into a black rim).
    const hasAtmo = p.uHasAtmosphere.greaterThan(0.5);
    const ndotv = clamp(dot(n, view), 0.0, 1.0);
    const limb = select(
      hasAtmo, float(1.0), mix(LIMB_FLOOR, 1.0, ndotv.pow(LIMB_EXP))).toVar();

    // The day map is sRGB-authored imagery loaded raw, so it decodes to
    // linear before it multiplies a physical luminance. uColour is already
    // linear (Planet.colour), so only the sampled branch decodes.
    const base = mix(p.uColour, srgbDecodeTsl(p.uMap.sample(vUvM).rgb), p.uHasMap).toVar();
    // Everything reflected off the ground shares this scale, so a term
    // added to it needs no albedo factor of its own.
    const surfaceScale = base.mul(p.uSurfaceLuminance).mul(shadow).toVar();
    const reflected = dayside.mul(limb).mul(p.uPhaseScale).toVar();
    const col = surfaceScale.mul(reflected).toVar();
    // Refracted, Rayleigh-reddened sunlight inside a caster's umbra — an
    // ADDITIVE illuminant, not a floor on `shadow`, weighted by 1 − shadow
    // so it fills exactly what the caster removed
    // (../../solar-system/planets/eclipses/README.md § Umbral glow).
    col.addAssign(base.mul(p.uSurfaceLuminance).mul(float(1.0).sub(shadow))
      .mul(p.uUmbralGlow).mul(reflected));
    // Terrain interreflection — the sunlit slopes around this patch
    // scattering light into it, and on an airless body the ONLY thing
    // lighting ground the skyline has shadowed.
    col.addAssign(surfaceScale.mul(
      p.uTerrainAlbedo.mul(terrainView).mul(max(sunCos, 0.0))
        .mul(limb).mul(p.uPhaseScale)));

    If(hasAtmo, () => {
      // Skylight: the air overhead scattering host light down. sunCos is
      // the REAL-space cosine, unlike the march below — solar depression is
      // measured against the ground observer's true local horizontal.
      col.addAssign(surfaceScale.mul(skyIrradianceTsl(
        sunCos, p.uScaleHeightR,
        verticalScatterTauTsl(
          p.uBetaRayleigh, p.uBetaMie, p.uScaleHeightR, p.uScaleHeightM),
        p.uBetaAbsorb.mul(p.uScaleHeightM))));

      // Airlight in front of this fragment + the transmittance the surface
      // radiance loses on its way out, marched in the unit-sphere frame.
      // The fragment's smooth surface point IS its direction there.
      const surf = scalePolarTsl(n, p.uPoleView, p.uPolarRadiusR).normalize();
      const o = deflattenedCameraTsl(
        p.uCenterView, p.uRadiusPc, p.uPoleView, p.uPolarRadiusR).toVar();
      const toSurf = surf.sub(o);
      const tStop = length(toSurf).toVar();
      const dir = toSurf.div(tStop).toVar();
      const sunDirR = deflattenedDirTsl(
        p.uSunDirView, p.uPoleView, p.uPolarRadiusR).toVar();
      const shell = shellEntryTsl(o, dir, p.uAtmoRadius).toVar();
      const tStart = select(shell.x.greaterThan(0.0), max(shell.y, 0.0), float(0.0));
      const march = atmosphereRadianceTsl({
        o, d: dir, tStart, tStop, rAtmo: p.uAtmoRadius, sunDir: sunDirR,
        hR: p.uScaleHeightR, hM: p.uScaleHeightM, betaRs: p.uBetaRayleigh,
        betaMs: p.uBetaMie, betaA: p.uBetaAbsorb, g: p.uMieG,
        jitter: interleavedGradientNoiseTsl(screenCoordinate.xy),
      });
      col.assign(col.mul(march.transmittance)
        .add(march.inscatter.mul(p.uSunColour).mul(p.uAirlightLuminance)));
    });

    col.assign(min(col, vec3(LUMA_CEIL)));
    // True surface brightness, and the alpha mirrors attachment 0's so the
    // LOD crossfade composites both attachments alike. The mask cuts at the
    // geometric terminator because that is where the disc mean the exposure
    // pin holds at L_TARGET is defined.
    const surfaceL = dot(col, lumaWeightsTsl());
    const lit = step(0.0, sunCos).mul(step(0.5, shadow));
    // Undithered: the ring annulus and the atmosphere shell alpha-blend
    // over this surface, so a pixel can take more than one planet fragment
    // and the fragCoord-keyed dither would bias it once per layer.
    const shown = select(
      u.uHdrTarget.lessThan(0.5),
      tonemapUnditheredTsl(col, u.uWhitePoint, u.uHighlightDesat),
      col);
    return {
      colour: vec4(shown, p.uFade),
      statistic: maskedStatisticTexelTsl(
        gates.statisticWrites, surfaceL, lit, p.uFade),
      diffuse: occluderTexelTsl(p.uFade),
    };
  });
}
