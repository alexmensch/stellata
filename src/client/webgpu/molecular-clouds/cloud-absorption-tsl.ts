// cloud-absorption.vert.glsl / .frag.glsl on the TSL path: the jittered
// ellipsoid raymarch that dims every diffuse layer behind the cloud.

import { BackSide, NormalBlending } from 'three';
import {
  Break, Discard, If, Loop, cameraPosition, clamp, dot, exp, float, int, length,
  max, min, modelWorldMatrix, normalize, positionGeometry, pow, screenCoordinate,
  smoothstep, sqrt, varying, vec3, vec4,
} from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import {
  ALPHA_CAP, AV_PER_DENSITY, AV_RATE_PER_NH, AV_SATURATED, ENVELOPE_TAPER_FRAC,
  TAU_PER_AV,
} from '../../molecular-clouds/cloud-presence-pure';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import { interleavedGradientNoiseTsl } from '../tsl/jitter-tsl';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import type { CloudAbsorptionNodes, CloudFieldNodes } from './cloud-uniform-nodes';

/** Minimum steps, and the shortest chord worth marching at all. */
const MIN_STEPS = 4;
const MIN_CHORD_T = 1e-6;
const DITHER_SEED_OFFSET = 113.7;

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
  // Alpha-only premultiplied-over: rgb = 0, so this is background × (1 − α).
  material.blending = NormalBlending;
  material.premultipliedAlpha = true;
  // BackSide: exactly one fragment per covered pixel from outside AND
  // inside — the raymarch segment is analytic either way, and FrontSide
  // would kill the inside-the-cloud absorption.
  material.side = BackSide;

  // The unit-sphere frame the march runs in. `position` is already in it;
  // the camera is rotated into cloud-local pc and divided by the semi-axes.
  // Both are per-vertex, so NodeMaterial's own MVP still writes clip space
  // and this material carries no vertexNode.
  const vPosUnit = varying(positionGeometry, 'vCloudPosUnit');
  const meshWorld = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  const vCamUnit = varying(
    c.uInvQuat.mul(cameraPosition.sub(meshWorld)).div(c.uAxes), 'vCloudCamUnit');

  return finishMrtMaterial(material, () => {
    const ro = vCamUnit.toVar();
    const rd = normalize(vPosUnit.sub(vCamUnit)).toVar();

    // Ray through the envelope sphere u = uUEnv. Density is identically
    // zero outside it, so clipping the march there concentrates the step
    // budget on nonzero density — and for a mass-budget-tightened cloud
    // (uEnv ≪ 1) discards most of the projected disc in one dot product.
    const b = dot(ro, rd).toVar();
    const disc = b.mul(b).sub(dot(ro, ro).sub(c.uUEnv.mul(c.uUEnv))).toVar();
    // max() before the root so a miss yields finite t values rather than
    // NaN: WGSL's discard is not a return, so the arithmetic below still
    // runs on a fragment that will be thrown away.
    const sq = sqrt(max(disc, 0.0)).toVar();
    const t0 = max(b.negate().sub(sq), 0.0).toVar();
    const t1 = b.negate().add(sq).toVar();

    const hit = disc.greaterThan(0.0).and(t1.sub(t0).greaterThanEqual(MIN_CHORD_T));
    Discard(hit.not());

    const av = float(0.0).toVar();
    // Guarding the whole march on the same condition it discards on: the
    // invocation keeps running past a discard, so without this a miss
    // would still pay for the loop (and divide by a zero-length chord).
    If(hit, () => {
      const dlPerT = length(rd.mul(c.uAxes)).toVar();
      // Screen-adaptive step budget: never more steps than the chord's
      // projected pixel extent can show.
      const chordPc = t1.sub(t0).mul(dlPerT);
      const midDistPc = max(t0.add(t1).mul(0.5).mul(dlPerT), MIN_CHORD_T);
      const footprintMidPc = midDistPc.mul(u.uFovYRad).div(u.uViewport.y);
      // Clamped in float and truncated after, rather than GLSL's truncate-
      // then-clamp: identical for every input, and it keeps one int node out
      // of an otherwise float graph.
      const steps = int(clamp(
        chordPc.div(max(footprintMidPc, MIN_CHORD_T)),
        float(MIN_STEPS), c.uSteps)).toVar();
      const dt = t1.sub(t0).div(float(steps)).toVar();
      const stepPc = dt.mul(dlPerT).toVar();
      const jitter = interleavedGradientNoiseTsl(screenCoordinate.xy).toVar();

      Loop({ start: int(0), end: steps, condition: '<' }, ({ i }) => {
        // The GLSL's `break` once the column has saturated the cap. Braced
        // rather than a concise arrow: a jump handed back as the branch's
        // output is emitted twice (`../tsl/README.md` § TSL test pattern).
        If(av.greaterThan(AV_SATURATED), () => { Break(); });
        const t = t0.add(float(i).add(jitter).mul(dt));
        const pu = ro.add(rd.mul(t)).toVar();
        if (field !== null) {
          // Traced tier: integrate the per-cloud Edenhofer density brick —
          // the exact field the rim isosurface was traced from, so shadow
          // and silhouette agree 1:1.
          const off = field.uCenterFromAabb.add(field.uRotMat.mul(pu.mul(c.uAxes)));
          const d = field.uBrick.sample(off.mul(field.uUvwScale).add(field.uUvwBias)).r
            .mul(field.uDensityMax);
          av.addAssign(d.mul(AV_PER_DENSITY).mul(stepPc));
        } else {
          // Analytic tier: the calibrated Plummer profile, clipped at the
          // mass-budget envelope. The GLSL's `continue` becomes the branch
          // it guarded — same reason the break is braced.
          const uu = length(pu).toVar();
          const env = float(1.0).sub(
            smoothstep(c.uUEnv.mul(ENVELOPE_TAPER_FRAC), c.uUEnv, uu)).toVar();
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
    // ±0.5-LSB output dither.
    const dither = interleavedGradientNoiseTsl(screenCoordinate.xy.add(DITHER_SEED_OFFSET))
      .sub(0.5).div(255.0);
    const texel = vec4(vec3(0.0), clamp(alpha.add(dither), 0.0, ALPHA_CAP));
    // Attachment 2 carries the diffuse emitters until the resolve convolves
    // them, and one blend equation covers every attachment — so the SAME
    // alpha-only texel is what dims the band and the LG glow. Writing only
    // attachment 0 leaves the clouds drawing, sorting correctly, and
    // extincting nothing. The statistic takes the blend's identity (alpha
    // 0 leaves the destination) — an absorber makes no claim on it.
    return { colour: texel, statistic: vec4(0.0), diffuse: texel };
  });
}
