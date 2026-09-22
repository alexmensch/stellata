// ShellMaterials test double, shared by the two shells' suites.
// See README.md § The material seam.

import { surfaceRecorder, type FakeEmitterMaterial } from '../scene/emitter-material-mock';
import { applyRimParams, type ShellMaterials, type FresnelShellMaterialOptions } from './fresnel-shell';
import { DEPTH_DIM_POWER, rimDistancesForExtent } from './shell-distance-pure';

export interface FakeShellMaterials extends ShellMaterials {
  /** One per `fresnelShell()` call, in build order. */
  readonly surfaces: FakeEmitterMaterial[];
}

/** Seeds the rim slots the way every factory does, so a consumer's later
 *  `setRimParams` writes over a live value rather than `undefined`. */
export function fakeShellMaterials(): FakeShellMaterials {
  const recorder = surfaceRecorder((surface, opts: FresnelShellMaterialOptions) => {
    applyRimParams(surface.uniforms, {
      alphaLimb: opts.alphaLimb,
      faceOnFloor: opts.faceOnFloor,
      fresnelPower: opts.fresnelPower,
      depthPower: DEPTH_DIM_POWER,
      ...rimDistancesForExtent(opts.extentPc),
    });
  });
  return { surfaces: recorder.surfaces, fresnelShell: (opts) => recorder.mint(opts) };
}
