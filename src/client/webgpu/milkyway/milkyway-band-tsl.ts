// milkyway.{vert,frag}.glsl on the TSL path: the log-distributed march
// through a proxy mesh, with running per-channel dust extinction.
// CPU mirror: ../../milkyway/milkyway-column-pure.ts.

import { AdditiveBlending, BackSide } from 'three';
import {
  Break, If, Loop, abs, cameraPosition, dFdx, dFdy, dot, exp, float, length,
  log, log2, max, positionGeometry, positionWorld, select, smoothstep, sqrt,
  varying, vec3, vec4,
} from 'three/tsl';
import { NodeMaterial, type Node } from 'three/webgpu';
import {
  FOREGROUND_DUST_STEPS, MAG_PER_TAU, S_MIN_PC, STEPS, UNIT_BALL_SLACK,
} from '../../milkyway/milkyway-column-pure';
import { LUMA_WEIGHTS } from '../../hdr/tonemap-pure';
import {
  extendedThresholdSbTsl, footprintAlongTsl, footprintPcTsl, softenRadiusTsl,
} from '../emission-tsl';
import { emitExtendedSourceTsl, emitNothingTsl } from '../extended-emitter-tsl';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import type { BandComponentNodes, BandSharedNodes } from './band-uniform-nodes';

type NF = Node<'float'>;
type N3 = Node<'vec3'>;

/** ln(10), for the log10 the surface-brightness domain needs. */
const LOG10_FROM_LOG2 = Math.log10(2);

export function buildMilkyWayBandMaterial(
  u: SharedUniformNodes,
  s: BandSharedNodes,
  c: BandComponentNodes,
  isBulge: boolean,
): MrtEmitterMaterial {
  const material = new NodeMaterial();
  material.name = isBulge ? 'mw-bulge-tsl' : 'mw-disc-tsl';
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = false;
  material.blending = AdditiveBlending;
  material.side = BackSide;

  // The GLSL vertex stage is the default model-view-projection plus two
  // varyings, both TSL built-ins — so this material carries no vertexNode.
  const vMeshLocalPos = varying(positionGeometry, 'vMwMeshLocalPos');
  const vWorldPos = varying(positionWorld, 'vMwWorldPos');

  const analyticalDustDensity = (R: NF, zVal: NF): NF =>
    s.uAnalyticalDustNormPerPc
      .mul(exp(R.sub(s.uR0Pc).negate().div(s.uAnalyticalDustScaleLengthPc)))
      .mul(exp(abs(zVal).negate().div(s.uAnalyticalDustScaleHeightPc)));

  /** Per-channel optical depth of one step, CCM reddening applied to τ_V. */
  const dustTauStepRGB = (R: NF, zVal: NF, dsPc: NF, dustEffective: NF): N3 =>
    analyticalDustDensity(R, zVal)
      .mul(s.uDustAvPerDensityPc).mul(dustEffective).div(MAG_PER_TAU)
      .mul(s.uReddeningRGB).mul(dsPc);

  const discDensityVal = (R: NF, zVal: NF, footprintPc: NF, zFootprintPc: NF): NF => {
    const absZ = softenRadiusTsl(abs(zVal), zFootprintPc);
    const vertical = exp(absZ.negate().div(c.uDiscScaleHeightPc))
      .add(c.uDiscThickFraction.mul(exp(absZ.negate().div(c.uDiscThickScaleHeightPc))));
    return c.uDensity0
      .mul(exp(softenRadiusTsl(R, footprintPc).sub(s.uR0Pc).negate()
        .div(c.uDiscScaleLengthPc)))
      .mul(vertical);
  };

  const bulgeDensityVal = (R: NF, zVal: NF, footprintPc: NF): NF => {
    const zEff = zVal.div(c.uBulgeAxisRatio);
    const rPrime = softenRadiusTsl(
      sqrt(R.mul(R).add(zEff.mul(zEff))), footprintPc);
    return c.uDensity0.mul(exp(rPrime.negate().div(c.uBulgeScaleRadiusPc)));
  };

  return finishMrtMaterial(material, () => {
    // Renderer-local → galactocentric ICRS → galactocentric galactic →
    // mesh-local (component-wise divide by half-axes).
    const camGalCentric = s.uIcrsToGal.mul(cameraPosition.sub(s.uGalCenter)).toVar();
    const camLocal = camGalCentric.div(c.uMeshScalePc).toVar();

    // Ray runs camLocal → vMeshLocalPos. NOT normalised: under non-uniform
    // mesh scale the local-frame length is direction-dependent.
    const dirLocal = vMeshLocalPos.sub(camLocal).toVar();
    const a = dot(dirLocal, dirLocal).toVar();
    const b = dot(camLocal, dirLocal).toVar();
    const cc = dot(camLocal, camLocal).sub(1.0).toVar();
    const disc = b.mul(b).sub(a.mul(cc)).toVar();

    // max() before the root so a miss stays finite: WGSL keeps running
    // past a discard, and there is no value-carrying return to bail with.
    const sqrtDisc = sqrt(max(disc, 0.0));
    // Front-face entry (smaller root). Camera inside ⇒ tEnter < 0 ⇒ clamp.
    // Back-face exit IS the fragment by construction — t = 1.
    const tEnter = max(b.negate().sub(sqrtDisc).div(a), 0.0).toVar();
    const worldPerT = length(vWorldPos.sub(cameraPosition)).toVar();
    const sStart = max(tEnter.mul(worldPerT), S_MIN_PC).toVar();

    // The GLSL's three early returns, as one predicate.
    const covered = disc.greaterThanEqual(0.0)
      .and(tEnter.lessThan(1.0))
      .and(sStart.lessThan(worldPerT));

    const colorAccum = vec3(0.0).toVar();
    const dustEffective = s.uDustEnabled.mul(s.uExtinctionStrength).toVar();
    const dirGalCentric = dirLocal.mul(c.uMeshScalePc).toVar();

    If(covered, () => {
      // The integration volume starts at the mesh front face; the dust slab
      // does not. A component the camera sits outside of — the bulge, from
      // anywhere in the disc — has to emit through this column first.
      // Linear rather than log-distributed: this span's integrand rises
      // toward its FAR end.
      const tauAccum = vec3(0.0).toVar();
      If(dustEffective.greaterThan(0.0).and(sStart.greaterThan(S_MIN_PC)), () => {
        const dsPc = sStart.sub(S_MIN_PC).div(FOREGROUND_DUST_STEPS).toVar();
        Loop(FOREGROUND_DUST_STEPS, ({ i }) => {
          const sMid = float(S_MIN_PC).add(float(i).add(0.5).mul(dsPc));
          const pos = camGalCentric.add(dirGalCentric.mul(sMid.div(worldPerT))).toVar();
          tauAccum.addAssign(
            dustTauStepRGB(length(pos.xy), pos.z, dsPc, dustEffective));
        });
      });

      const logMin = log(sStart).toVar();
      const logStep = log(worldPerT).sub(logMin).div(STEPS).toVar();
      const zFootprintScale = footprintAlongTsl(
        dirGalCentric.normalize(), vec3(0.0, 0.0, 1.0)).toVar();
      const prevS = sStart.toVar();

      Loop(STEPS, ({ i }) => {
        const sBoundary = exp(logMin.add(float(i).add(1.0).mul(logStep))).toVar();
        const sMid = exp(logMin.add(float(i).add(0.5).mul(logStep))).toVar();
        const dsPc = sBoundary.sub(prevS).toVar();
        prevS.assign(sBoundary);

        const pLocal = camLocal.add(dirLocal.mul(sMid.div(worldPerT))).toVar();
        // Outside the unit sphere → outside the integration volume.
        // Braced, so the jump is not emitted twice
        // (`../tsl/README.md` § TSL test pattern).
        If(dot(pLocal, pLocal).greaterThan(UNIT_BALL_SLACK), () => { Break(); });

        const posGalCentric = pLocal.mul(c.uMeshScalePc).toVar();
        const R = length(posGalCentric.xy).toVar();
        const zVal = posGalCentric.z.toVar();
        const footprintPc = footprintPcTsl(sMid, u.uOmegaPxArcsec2).toVar();
        const densityVal = isBulge
          ? bulgeDensityVal(R, zVal, footprintPc)
          : discDensityVal(R, zVal, footprintPc, footprintPc.mul(zFootprintScale));

        const dTauRGB = dustTauStepRGB(R, zVal, dsPc, dustEffective).toVar();
        // Beer-Lambert with half-step self-shielding for the slab approx.
        const transmittance = exp(tauAccum.negate()).mul(exp(dTauRGB.mul(-0.5)));
        colorAccum.addAssign(
          transmittance.mul(densityVal).mul(c.uColor).mul(dsPc));
        tauAccum.addAssign(dTauRGB);
      });
    });

    // uGlowMagOffset states the V surface brightness a unit column carries,
    // so this sightline reads S = uGlowMagOffset − 2.5·log10(column). Only
    // the isobar needs the magnitude domain; the emission path takes the
    // round-trip as one scalar gain inside the emitter tail. Computed
    // outside the branch so the derivatives stay in uniform control flow.
    const column = max(dot(colorAccum, vec3(...LUMA_WEIGHTS)), 1e-12);
    const sb = s.uGlowMagOffset.sub(log2(column).mul(2.5 * LOG10_FROM_LOG2)).toVar();

    // Chart isobar: a single solid contour where the sightline's SURFACE
    // BRIGHTNESS crosses the extended-source threshold. Surface brightness
    // carries no Ω_px term, so the line is FOV- and viewport-invariant.
    // `fwidth` has no TSL node — it is |dFdx| + |dFdy| by definition — and
    // keeps the line a constant 1 px wide however steep the gradient is.
    const fw = max(abs(dFdx(sb)).add(abs(dFdy(sb))), 1e-5).toVar();
    const thresholdSb = extendedThresholdSbTsl(u.uOmegaSummationArcsec2, u.uLimitMag);
    const line = float(1.0).sub(
      smoothstep(fw.mul(0.5), fw.mul(1.5), abs(sb.sub(thresholdSb)))).toVar();

    const lit = emitExtendedSourceTsl({
      column: colorAccum,
      exposure: u.uExposure,
      magPerArcsec2: s.uGlowMagOffset,
      omegaSummationArcsec2: u.uOmegaSummationArcsec2,
      omegaPxArcsec2: u.uOmegaPxArcsec2,
      hdrTarget: u.uHdrTarget,
      whitePoint: u.uWhitePoint,
      highlightDesat: u.uHighlightDesat,
    });
    const nothing = emitNothingTsl();

    // Three outcomes, resolved as nested selects because none of them can
    // be a return: no coverage, the isobar contour, or the emission.
    const isobar = s.uChartIsobar.greaterThan(0.5);
    const isobarLive = isobar.and(line.greaterThan(0.0));
    const show = covered.and(isobar.not().or(line.greaterThan(0.0)));
    return {
      colour: select(show,
        select(isobarLive, vec4(s.uChartInkColor.mul(line), line), lit.colour),
        nothing.colour),
      // The isobar is chart ink, not light: it claims neither the
      // statistic nor the diffuse attachment.
      statistic: select(show.and(isobar.not()), lit.statistic, nothing.statistic),
      diffuse: select(show.and(isobar.not()), lit.diffuse, nothing.diffuse),
    };
  });
}
