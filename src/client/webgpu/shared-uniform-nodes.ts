// TSL uniform-node mirror of the WebGL-side shared map
// (../frame/shared-uniforms.ts). Reference/sync contract: README.md
// § Shared uniform nodes.

import { Vector4 } from 'three';
import { uniform } from 'three/tsl';
import type { SharedUniforms } from '../frame/shared-uniforms';

/** Slots the registry does not mirror: a texture binds as a per-layer
 *  texture()/texture3D() node where the texture object lives — a uniform
 *  node cannot carry a nullable texture. */
export const TEXTURE_SLOTS = ['uDustTexture', 'uAvPrepassTex', 'uColorLut'] as const;

export type SharedUniformNodes = SharedUniformNodeRegistry['nodes'];

export interface SharedUniformNodeRegistry {
  nodes: ReturnType<typeof buildNodes>;
  /** Copy every scalar slot's current value from the WebGL-side map into
   *  its node, and re-split the member-index array. Vector slots need no
   *  copy — their node holds the map's value object by reference. Called
   *  once per rendered frame, before the render. */
  sync(): void;
}

// Transcribed rather than derived from a loop over `shared`, deliberately:
// each node's type comes from three's own uniform() overloads resolving
// against a concrete value, and a loop cannot give them one. Typing a
// derived version needs UniformNode — which neither three/webgpu nor
// three/tsl exports — plus a hand-written value-kind ladder, i.e. a second
// deep import into three's internals to save a transcription that key
// parity already guards. Only the VECTOR lines are load-bearing here; every
// scalar's construction value is overwritten by the first sync().
function buildNodes(shared: SharedUniforms) {
  const m = shared.uLocalMemberIdx.value;
  return {
    uHdrTarget: uniform(shared.uHdrTarget.value),
    uWhitePoint: uniform(shared.uWhitePoint.value),
    uHighlightDesat: uniform(shared.uHighlightDesat.value),
    uExposure: uniform(shared.uExposure.value),
    uOmegaPxArcsec2: uniform(shared.uOmegaPxArcsec2.value),
    uOmegaSummationArcsec2: uniform(shared.uOmegaSummationArcsec2.value),
    uCameraPos: uniform(shared.uCameraPos.value),
    uLimitMag: uniform(shared.uLimitMag.value),
    uThresholdMag: uniform(shared.uThresholdMag.value),
    uCullMag: uniform(shared.uCullMag.value),
    uMinDistSol: uniform(shared.uMinDistSol.value),
    uMaxDistSol: uniform(shared.uMaxDistSol.value),
    uSpectMask: uniform(shared.uSpectMask.value, 'uint'),
    uPixelRatio: uniform(shared.uPixelRatio.value),
    uSizeMin: uniform(shared.uSizeMin.value),
    uSizeMax: uniform(shared.uSizeMax.value),
    uSizeSpan: uniform(shared.uSizeSpan.value),
    uMonochrome: uniform(shared.uMonochrome.value),
    uChartDiscMaxPx: uniform(shared.uChartDiscMaxPx.value),
    uChartDiscMinPx: uniform(shared.uChartDiscMinPx.value),
    uChartMagBright: uniform(shared.uChartMagBright.value),
    uFovYRad: uniform(shared.uFovYRad.value),
    uRSunPc: uniform(shared.uRSunPc.value),
    uViewport: uniform(shared.uViewport.value),
    uMaxPhysFrac: uniform(shared.uMaxPhysFrac.value),
    uModelDays: uniform(shared.uModelDays.value),
    uModelDaysPerRealSec: uniform(shared.uModelDaysPerRealSec.value),
    uMinPeriodSec: uniform(shared.uMinPeriodSec.value),
    uVisibleThreshold: uniform(shared.uVisibleThreshold.value),
    uVisibleK: uniform(shared.uVisibleK.value),
    uCoreThreshold: uniform(shared.uCoreThreshold.value),
    uDiscardThreshold: uniform(shared.uDiscardThreshold.value),
    uDistNMin: uniform(shared.uDistNMin.value),
    uDistNMax: uniform(shared.uDistNMax.value),
    uLumBiasMin: uniform(shared.uLumBiasMin.value),
    uLumBiasMax: uniform(shared.uLumBiasMax.value),
    uSizeKnee: uniform(shared.uSizeKnee.value),
    uDustBoundsPc: uniform(shared.uDustBoundsPc.value),
    uDustDensityMin: uniform(shared.uDustDensityMin.value),
    uDustLogRatio: uniform(shared.uDustLogRatio.value),
    uDustAvPerDensityPc: uniform(shared.uDustAvPerDensityPc.value),
    uDustEnabled: uniform(shared.uDustEnabled.value),
    uExtinctionStrength: uniform(shared.uExtinctionStrength.value),
    uWorldOffset: uniform(shared.uWorldOffset.value),
    uAvPrepassEnabled: uniform(shared.uAvPrepassEnabled.value),
    uHideFocusIdx: uniform(shared.uHideFocusIdx.value, 'int'),
    uPinFocusToCenter: uniform(shared.uPinFocusToCenter.value, 'int'),
    // The 8-slot Int32Array packs as two ivec4s — WGSL uniform arrays pad
    // to a 16-byte stride, so an int[8] would waste 96 bytes and a worse
    // access pattern.
    uLocalMemberIdx0: uniform(new Vector4(m[0], m[1], m[2], m[3]), 'ivec4'),
    uLocalMemberIdx1: uniform(new Vector4(m[4], m[5], m[6], m[7]), 'ivec4'),
  };
}

export function buildSharedUniformNodes(shared: SharedUniforms): SharedUniformNodeRegistry {
  const nodes = buildNodes(shared);
  const scalarKeys = (Object.keys(nodes) as (keyof typeof nodes)[]).filter(
    (k): k is keyof typeof nodes & keyof SharedUniforms =>
      k in shared && typeof shared[k as keyof SharedUniforms].value === 'number',
  );
  return {
    nodes,
    sync() {
      for (const k of scalarKeys) {
        (nodes[k] as { value: number }).value = shared[k].value as number;
      }
      const members = shared.uLocalMemberIdx.value;
      nodes.uLocalMemberIdx0.value.set(members[0], members[1], members[2], members[3]);
      nodes.uLocalMemberIdx1.value.set(members[4], members[5], members[6], members[7]);
    },
  };
}
