// The cloud material seam's uniform blocks
// (../../molecular-clouds/cloud-materials.ts) as TSL nodes.

import { Color } from 'three';
import { texture3D, uniform } from 'three/tsl';
import type {
  CloudAbsorptionSpec, CloudFieldSpec,
} from '../../molecular-clouds/cloud-materials';
import {
  DEFAULT_FACE_ON_FLOOR, DEFAULT_FRESNEL_POWER, SHELL_RIM_ALPHA_LIMB, SHELL_RIM_BLUE,
} from '../../fresnel-shell/fresnel-shell';
import {
  DEPTH_DIM_POWER,
} from '../../fresnel-shell/shell-distance-pure';
import { CLOUD_RIM_DISTANCES } from '../../molecular-clouds/cloud-rim-pure';
import { setRawChromeColour } from '../../hdr/chrome/chrome-colour';

/**
 * The per-cloud slots an absorption material carries.
 *
 * Seeded from the spec rather than a neutral default the layer overwrites,
 * because the tier is a compile-time choice here: a material built for the
 * wrong `uUEnv` would march the wrong envelope from its first frame, and
 * there is no later write that would fix it.
 *
 * `uFovYRad` and `uViewport` are deliberately absent — they come off the
 * uniform-node mirror
 * (`README.md#the-shared-pair-is-not-in-this-record`).
 */
export function cloudAbsorptionUniformNodes(spec: CloudAbsorptionSpec) {
  return {
    uAxes: uniform(spec.axes.clone()),
    uN0Cal: uniform(spec.n0Cal),
    uRflat: uniform(spec.rflatPc),
    uP: uniform(spec.p),
    uUEnv: uniform(spec.uEnv),
    uInvQuat: uniform(spec.invQuat.clone()),
    // Float: the march clamps in float and truncates once for the loop
    // bound, so an int node here would be converted straight back.
    uSteps: uniform(spec.steps),
  };
}

export type CloudAbsorptionNodes = ReturnType<typeof cloudAbsorptionUniformNodes>;

/** The traced tier's extra slots. Absent on the analytic tier, which is
 *  why they are a second record rather than nullable members of the first:
 *  the graph that reads them is a different graph. */
export function cloudFieldUniformNodes(field: CloudFieldSpec) {
  return {
    uBrick: texture3D(field.brick),
    uDensityMax: uniform(field.densityMax),
    uCenterFromAabb: uniform(field.centerFromAabb.clone()),
    uRotMat: uniform(field.rotMat.clone()),
    uUvwScale: uniform(field.uvwScale.clone()),
    uUvwBias: uniform(field.uvwBias.clone()),
  };
}

export type CloudFieldNodes = ReturnType<typeof cloudFieldUniformNodes>;

/** One rim material serves every cloud, so these are neutral defaults the
 *  layer's setters then drive. `uColour` seeds through the chrome
 *  inverse: the registry is keyed by the
 *  live `Color`, and a node holds one as its `.value`. */
export function cloudRimUniformNodes(inkHex: number, inkAlpha: number, opacity: number) {
  return {
    uColour: uniform(setRawChromeColour(new Color(), SHELL_RIM_BLUE)),
    uAlphaLimb: uniform(SHELL_RIM_ALPHA_LIMB),
    uFaceOnFloor: uniform(DEFAULT_FACE_ON_FLOOR),
    uFresnelPower: uniform(DEFAULT_FRESNEL_POWER),
    uNearFadePc: uniform(CLOUD_RIM_DISTANCES.nearFadePc),
    uDepthDimRefPc: uniform(CLOUD_RIM_DISTANCES.depthDimRefPc),
    uDepthPower: uniform(DEPTH_DIM_POWER),
    uOpacity: uniform(opacity),
    uChart: uniform(0),
    uInk: uniform(new Color(inkHex)),
    uInkAlpha: uniform(inkAlpha),
  };
}

export type CloudRimNodes = ReturnType<typeof cloudRimUniformNodes>;
