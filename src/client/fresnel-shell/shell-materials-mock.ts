// ShellMaterials test double, shared by the two shells' suites.
// See README.md § The material seam.

import { fakeEmitterMaterial, type FakeEmitterMaterial } from '../scene/emitter-material-mock';
import { applyRimParams, type ShellMaterials } from './fresnel-shell';
import { DEPTH_DIM_POWER, rimDistancesForExtent } from './shell-distance-pure';

export interface FakeShellMaterials extends ShellMaterials {
  /** One per `fresnelShell()` call, in build order. */
  readonly surfaces: FakeEmitterMaterial[];
}

/** Seeds the rim slots the way every factory does, so a consumer's later
 *  `setRimParams` writes over a live value rather than `undefined`. */
export function fakeShellMaterials(): FakeShellMaterials {
  const surfaces: FakeEmitterMaterial[] = [];
  return {
    surfaces,
    fresnelShell(opts) {
      const surface = fakeEmitterMaterial();
      surfaces.push(surface);
      applyRimParams(surface.uniforms, {
        alphaLimb: opts.alphaLimb,
        faceOnFloor: opts.faceOnFloor,
        fresnelPower: opts.fresnelPower,
        depthPower: DEPTH_DIM_POWER,
        ...rimDistancesForExtent(opts.extentPc),
      });
      return surface;
    },
  };
}
