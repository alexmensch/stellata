// local-group-emission.{vert,frag}.glsl on the TSL path: the bounded
// volumetric raymarch through each object's proxy volume, both families.
// CPU mirror: ../../local-group/emission/local-group-emission-pure.ts.

import { AdditiveBlending, BackSide } from 'three';
import {
  Break, Fn, If, Loop, cameraPosition, cameraProjectionMatrix, cameraViewMatrix,
  cross, dot, exp, float, fract, length, log, max, positionGeometry, pow,
  screenCoordinate, select, sin, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { NodeMaterial, type Node } from 'three/webgpu';
import {
  EMISSION_JITTER_DOT, EMISSION_JITTER_SCALE, EMISSION_STEPS_DISC,
  EMISSION_STEPS_SERSIC, EMISSION_S_MIN_PC, EMISSION_UNIT_BALL_SLACK,
  EMISSION_U_FLOOR, MIN_PROJECTED_RADIUS_PX,
} from '../../local-group/emission/local-group-emission-pure';
import { UNIT_BALL_SLACK } from '../../milkyway/milkyway-column-pure';
import { SB_ZERO_POINT } from '../../hdr/emission/emission-pure';
import {
  footprintAlongTsl, footprintPcTsl, pxPerRadianTsl, softenRadiusTsl,
} from '../emission-tsl';
import { emitExtendedSourceTsl, emitNothingTsl } from '../extended-emitter-tsl';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { attrFloat, attrVec3, attrVec4 } from '../tsl/tsl-shim';

type NF = Node<'float'>;
type N3 = Node<'vec3'>;
type N4 = Node<'vec4'>;

const quatRotate = /* @__PURE__ */ Fn(([q, v]: [N4, N3]) =>
  v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2.0)));

export function buildLocalGroupEmissionMaterial(
  u: SharedUniformNodes,
  isDisc: boolean,
): MrtEmitterMaterial {
  const steps = isDisc ? EMISSION_STEPS_DISC : EMISSION_STEPS_SERSIC;
  const material = new NodeMaterial();
  material.name = isDisc ? 'lg-emission-disc-tsl' : 'lg-emission-sersic-tsl';
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = false;
  material.blending = AdditiveBlending;
  // BackSide gives one fragment per ray with the back face as the natural
  // exit; entry is computed analytically in the fragment stage.
  material.side = BackSide;

  // Per-instance, so every vertex of a triangle carries the same value and
  // interpolation is exact — GLSL's `flat` is a cost choice here, not a
  // correctness one, and TSL has no flat qualifier to spend on it.
  const vMeshLocalPos = varying(vec3(0), 'vLgMeshLocalPos');
  const vWorldPos = varying(vec3(0), 'vLgWorldPos');
  const vCamLocal = varying(vec3(0), 'vLgCamLocal');
  const vAxes = varying(vec3(0), 'vLgAxes');
  const vColor = varying(vec3(0), 'vLgColor');
  const vDisc = varying(vec3(0), 'vLgDisc');
  const vSersic = varying(vec4(0), 'vLgSersic');
  const vUMax = varying(float(0), 'vLgUMax');

  material.vertexNode = Fn(() => {
    const aCenterAbs = attrVec3('aCenterAbs');
    const aQuat = attrVec4('aQuat');
    const aAxes = attrVec3('aAxes');

    // Absolute-ICRS centre → renderer-local. f32 cancellation here leaves
    // ~0.25 pc error at the 2 Mpc envelope — invisible at galaxy scale.
    const centerLocal = aCenterAbs.sub(u.uWorldOffset).toVar();

    // Sub-pixel proxies expand to the resolution floor: axes × k, scale
    // lengths × k, density0 ÷ k³ leaves flux exact and the profile shape
    // identical. Sized off the LARGEST semi-axis, not the projected one:
    // over-expanding a mesh the viewer can already resolve would move a
    // visible silhouette.
    const pxPerRadian = pxPerRadianTsl(u.uOmegaPxArcsec2);
    const meshRadiusPc = max(max(aAxes.x, aAxes.y), aAxes.z);
    const distPc = max(length(cameraPosition.sub(centerLocal)), 1e-6);
    const meshRadiusPx = meshRadiusPc.div(distPc).mul(pxPerRadian);
    const k = max(float(MIN_PROJECTED_RADIUS_PX).div(max(meshRadiusPx, 1e-12)), 1.0).toVar();
    const densityScale = k.mul(k).mul(k).reciprocal();
    const axes = aAxes.mul(k).toVar();

    const world = centerLocal.add(quatRotate(aQuat, positionGeometry.mul(axes))).toVar();
    vMeshLocalPos.assign(positionGeometry);
    vWorldPos.assign(world);
    vCamLocal.assign(
      quatRotate(vec4(aQuat.xyz.negate(), aQuat.w), cameraPosition.sub(centerLocal))
        .div(axes));
    vAxes.assign(axes);
    vColor.assign(attrVec3('aColor'));
    if (isDisc) {
      // (density0, 1/R_d, 1/z_d) — the reciprocals scale by 1/k.
      const aDisc = attrVec3('aDisc');
      vDisc.assign(vec3(aDisc.x.mul(densityScale), aDisc.yz.div(k)));
    } else {
      // uMax is in R_e units and R_e = axes/uMax, so it rides the expansion
      // untouched; only the normalisation moves.
      const aSersic = attrVec4('aSersic');
      vSersic.assign(vec4(aSersic.x.mul(densityScale), aSersic.yzw));
      vUMax.assign(attrFloat('aUMax'));
    }
    return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1.0)));
  })();

  return finishMrtMaterial(material, () => {
    const dirLocal = vMeshLocalPos.sub(vCamLocal).toVar();
    const a = dot(dirLocal, dirLocal).toVar();
    const b = dot(vCamLocal, dirLocal).toVar();
    const c = dot(vCamLocal, vCamLocal).sub(1.0).toVar();
    const disc = b.mul(b).sub(a.mul(c)).toVar();

    // The GLSL's three early returns, as one coverage predicate: WGSL has
    // no value-carrying return, and each of them wrote the same all-zero
    // texel set.
    const sqDisc = max(disc, 0.0).sqrt();
    const tEnter = max(b.negate().sub(sqDisc).div(a), 0.0).toVar();
    const worldPerT = length(vWorldPos.sub(cameraPosition)).toVar();
    const sStart = max(tEnter.mul(worldPerT), EMISSION_S_MIN_PC).toVar();
    const covered = disc.greaterThanEqual(0.0)
      .and(tEnter.lessThan(1.0))
      .and(sStart.lessThan(worldPerT));

    const accum = float(0.0).toVar();
    If(covered, () => {
      const logMin = log(sStart).toVar();
      const logStep = log(worldPerT).sub(logMin).div(steps).toVar();
      // Per-pixel jitter of the in-step sample position: coherent midpoint
      // sampling bands the thin-disc vertical profile on grazing rays, and
      // the jitter trades the bands for fine noise while preserving the
      // expected column (the CPU mirror keeps deterministic midpoints).
      const jitter = fract(sin(dot(screenCoordinate.xy, vec2(...EMISSION_JITTER_DOT)))
        .mul(EMISSION_JITTER_SCALE)).toVar();
      // Null for the Sérsic family rather than zero: its profile depends on
      // the ellipsoidal radius alone, so there is no vertical share to
      // project and no separable extent to soften along.
      const zFootprintScale = isDisc
        ? footprintAlongTsl(dirLocal.mul(vAxes).normalize(), vec3(0.0, 0.0, 1.0)).toVar()
        : null;

      const prevS = sStart.toVar();
      Loop(steps, ({ i }) => {
        const sBoundary = exp(logMin.add(float(i).add(1.0).mul(logStep))).toVar();
        const sSample = exp(logMin.add(float(i).add(jitter).mul(logStep)));
        const dsPc = sBoundary.sub(prevS).toVar();
        prevS.assign(sBoundary);
        const pLocal = vCamLocal.add(dirLocal.mul(sSample.div(worldPerT))).toVar();
        // Braced, so the jump is not handed back as the branch's output
        // and emitted twice (`../tsl/README.md` § TSL test pattern).
        If(dot(pLocal, pLocal).greaterThan(EMISSION_UNIT_BALL_SLACK), () => { Break(); });
        const footprintPc = footprintPcTsl(sSample, u.uOmegaPxArcsec2).toVar();
        const density = zFootprintScale !== null
          ? discDensity(pLocal, vAxes, vDisc, footprintPc, footprintPc.mul(zFootprintScale))
          : sersicDensity(pLocal, vAxes, vSersic, vUMax, footprintPc);
        accum.addAssign(density.mul(dsPc));
      });
    });

    // accum is Σρ·ds, which the solver's normalisation makes flux per
    // steradian, so SB_ZERO_POINT is the surface brightness of a unit
    // column. vColor carries hue only — luma-normalised CPU-side — so the
    // scalar gain leaves the solved flux alone.
    const lit = emitExtendedSourceTsl({
      column: vColor.mul(accum),
      exposure: u.uExposure,
      magPerArcsec2: float(SB_ZERO_POINT),
      omegaSummationArcsec2: u.uOmegaSummationArcsec2,
      omegaPxArcsec2: u.uOmegaPxArcsec2,
      hdrTarget: u.uHdrTarget,
      whitePoint: u.uWhitePoint,
      highlightDesat: u.uHighlightDesat,
    });
    const nothing = emitNothingTsl();
    // A zero column is NOT the same texel set as no coverage: the
    // statistic's alpha is 1 for an extended source, so an uncovered
    // fragment would still add alpha under the additive blend.
    return {
      colour: select(covered, lit.colour, nothing.colour),
      statistic: select(covered, lit.statistic, nothing.statistic),
      diffuse: select(covered, lit.diffuse, nothing.diffuse),
    };
  });
}

/** ρ₀·exp(−R/R_d − |z|/z_d), each extent softened over its own share of
 *  the pixel footprint. */
function discDensity(
  pLocal: N3, axes: N3, disc: N3, footprintPc: NF, zFootprintPc: NF,
): NF {
  const phys = pLocal.mul(axes);
  const R = softenRadiusTsl(length(phys.xy), footprintPc);
  const z = softenRadiusTsl(phys.z.abs(), zFootprintPc);
  return disc.x.mul(exp(R.mul(disc.y).negate().sub(z.mul(disc.z))));
}

/** Deprojected Sérsic. The mesh axes are uMax × R_e, so the ellipsoidal
 *  radius in R_e units is uMax × the unit-ball radius, and the footprint
 *  converts with the same R_e = axes.x / uMax. */
function sersicDensity(
  pLocal: N3, axes: N3, sersic: N4, uMax: NF, footprintPc: NF,
): NF {
  const uu = softenRadiusTsl(length(pLocal).mul(axes.x), footprintPc).mul(uMax).div(axes.x);
  const uc = max(uu, EMISSION_U_FLOOR);
  return sersic.x.mul(pow(uc, sersic.w.negate()).mul(
    exp(pow(uc, sersic.y).mul(sersic.z).negate())));
}
