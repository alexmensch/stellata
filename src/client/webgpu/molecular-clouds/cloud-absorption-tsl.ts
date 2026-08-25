// cloud-absorption.vert.glsl / .frag.glsl on the TSL path: the jittered
// ellipsoid raymarch that dims every diffuse layer behind the cloud.

import {
  AddEquation, BackSide, CustomBlending, OneFactor, OneMinusSrcAlphaFactor,
} from 'three';
import {
  Break, Discard, If, Loop, cameraPosition, clamp, dot, exp, float, int, length,
  max, min, modelWorldMatrix, normalize, positionGeometry, pow, screenCoordinate,
  smoothstep, sqrt, varying, vec3, vec4,
} from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import { DITHER_SEED_OFFSET } from '../../hdr/tonemap-pure';
import {
  ALPHA_CAP, AV_PER_DENSITY, AV_RATE_PER_NH, AV_SATURATED, ENVELOPE_TAPER_FRAC,
  MARCH_MIN_CHORD_T, MARCH_MIN_STEPS, TAU_PER_AV,
} from '../../molecular-clouds/cloud-presence-pure';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import { interleavedGradientNoiseTsl, lsbDitherTsl } from '../tsl/jitter-tsl';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import type { CloudAbsorptionNodes, CloudFieldNodes } from './cloud-uniform-nodes';

export function buildCloudAbsorptionMaterial(
  u: SharedUniformNodes,
  c: CloudAbsorptionNodes,
  field: CloudFieldNodes | null,
): MrtEmitterMaterial {
  const material = new NodeMaterial();
  material.name = field === null ? 'cloud-absorption-tsl' : 'cloud-absorption-field-tsl';
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = false;
  // What `premultipliedAlpha: true` + NormalBlending means on the GLSL
  // twin, spelled out. Setting that flag HERE would silently demote the
  // three-member output struct to one attachment and fail the WGSL
  // compile (`../hdr/README.md` § The gate becomes the output struct), so
  // the flag is the one thing this material may not copy from its twin.
  material.blending = CustomBlending;
  material.blendSrc = OneFactor;
  material.blendDst = OneMinusSrcAlphaFactor;
  material.blendEquation = AddEquation;
  material.blendSrcAlpha = OneFactor;
  material.blendDstAlpha = OneMinusSrcAlphaFactor;
  material.blendEquationAlpha = AddEquation;
  material.side = BackSide;

  // Both are per-vertex, so NodeMaterial's own MVP still writes clip space
  // and this material carries no vertexNode.
  const vPosUnit = varying(positionGeometry, 'vCloudPosUnit');
  const meshWorld = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  const vCamUnit = varying(
    c.uInvQuat.mul(cameraPosition.sub(meshWorld)).div(c.uAxes), 'vCloudCamUnit');

  return finishMrtMaterial(material, () => {
    const ro = vCamUnit.toVar();
    const rd = normalize(vPosUnit.sub(vCamUnit)).toVar();

    const b = dot(ro, rd).toVar();
    const disc = b.mul(b).sub(dot(ro, ro).sub(c.uUEnv.mul(c.uUEnv))).toVar();
    // max() before the root so a miss yields finite t values rather than
    // NaN: WGSL's discard is not a return, so the arithmetic below still
    // runs on a fragment that will be thrown away.
    const sq = sqrt(max(disc, 0.0)).toVar();
    const t0 = max(b.negate().sub(sq), 0.0).toVar();
    const t1 = b.negate().add(sq).toVar();

    const hit = disc.greaterThan(0.0).and(t1.sub(t0).greaterThanEqual(MARCH_MIN_CHORD_T));
    Discard(hit.not());

    const av = float(0.0).toVar();
    // Guarding the whole march on the same condition it discards on: the
    // invocation keeps running past a discard, so without this a miss
    // would still pay for the loop (and divide by a zero-length chord).
    If(hit, () => {
      const dlPerT = length(rd.mul(c.uAxes)).toVar();
      const chordPc = t1.sub(t0).mul(dlPerT);
      const midDistPc = max(t0.add(t1).mul(0.5).mul(dlPerT), MARCH_MIN_CHORD_T);
      const footprintMidPc = midDistPc.mul(u.uFovYRad).div(u.uViewport.y);
      // Clamped in float and truncated after, rather than GLSL's truncate-
      // then-clamp: identical for every non-negative input, and it keeps one
      // int node out of an otherwise float graph.
      const steps = int(clamp(
        chordPc.div(max(footprintMidPc, MARCH_MIN_CHORD_T)),
        float(MARCH_MIN_STEPS), c.uSteps)).toVar();
      const dt = t1.sub(t0).div(float(steps)).toVar();
      const stepPc = dt.mul(dlPerT).toVar();
      const jitter = interleavedGradientNoiseTsl(screenCoordinate.xy).toVar();

      Loop({ start: int(0), end: steps, condition: '<' }, ({ i }) => {
        // Braced rather than a concise arrow: a jump handed back as the
        // branch's output is emitted twice (`../tsl/README.md` § TSL test
        // pattern).
        If(av.greaterThan(AV_SATURATED), () => { Break(); });
        const t = t0.add(float(i).add(jitter).mul(dt));
        const pu = ro.add(rd.mul(t)).toVar();
        if (field !== null) {
          const off = field.uCenterFromAabb.add(field.uRotMat.mul(pu.mul(c.uAxes)));
          const d = field.uBrick.sample(off.mul(field.uUvwScale).add(field.uUvwBias)).r
            .mul(field.uDensityMax);
          av.addAssign(d.mul(AV_PER_DENSITY).mul(stepPc));
        } else {
          const uu = length(pu).toVar();
          const env = float(1.0).sub(
            smoothstep(c.uUEnv.mul(ENVELOPE_TAPER_FRAC), c.uUEnv, uu)).toVar();
          // The GLSL's `continue` as the branch it guarded — same reason
          // the break above is braced.
          If(env.greaterThan(0.0), () => {
            const q = uu.mul(c.uAxes.z).div(c.uRflat).toVar();
            const density = pow(
              q.mul(q).add(1.0), c.uP.mul(-0.5)).mul(c.uN0Cal).mul(AV_RATE_PER_NH);
            av.addAssign(density.mul(env).mul(stepPc));
          });
        }
      });
    });

    const alpha = min(float(1.0).sub(exp(av.mul(-TAU_PER_AV))), ALPHA_CAP);
    const dither = lsbDitherTsl(screenCoordinate.xy.add(DITHER_SEED_OFFSET));
    const texel = vec4(vec3(0.0), clamp(alpha.add(dither), 0.0, ALPHA_CAP));
    // The same texel on both: on this backend the output struct IS the
    // attachment gate (`README.md` § The absorption writes attachment 2).
    return { colour: texel, statistic: vec4(0.0), diffuse: texel };
  });
}
