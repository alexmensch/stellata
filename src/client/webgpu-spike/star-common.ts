// Shared foundation for the WebGPU star-pipeline spike: uniform nodes,
// packed instanced geometry, per-pass render state.

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

export const R_V = 3.1;
export const LOG10 = 2.302585092994046;
export const PI = 3.141592653589793;
export const LUMA_CEIL = 4096.0;
export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;
export const TOE_KNEE = 0.02;
export const TOE_CURVATURE = 1.6887363;
export const MAG_PER_LOG2 = 0.7525750;
export const PHYS_RATIO_THRESHOLD = 0.5;
export const DUST_STEPS = 48;
export const R_SUN_PC = 2.2543e-8;
export const BV_MIN = -0.4;
export const BV_MAX = 2.0;

export const DEFAULT_LIMIT_MAG = 6.5;
export const L_THRESH = 0.02;

// Star pass indices. Compile-time per material (D1 in the port contract,
// ../star-pipeline/README.md § Early-z): the shared uRenderMode uniform
// of the WebGL2 build does not survive the port.
export const PASS_GLOW = 0;
export const PASS_DISC_CORE = 1;
export const PASS_DISC_HALO = 2;
export const PASS_CORE_MASK = 3;
export type StarPass =
  | typeof PASS_GLOW
  | typeof PASS_DISC_CORE
  | typeof PASS_DISC_HALO
  | typeof PASS_CORE_MASK;

export const STAR_PASSES: StarPass[] = [
  PASS_CORE_MASK, PASS_DISC_CORE, PASS_DISC_HALO, PASS_GLOW,
];

export function passName(pass: StarPass): string {
  return ['glow', 'discCore', 'discHalo', 'coreMask'][pass];
}

/** Shared uniform nodes — one instance drives both implementations, so a
 *  HUD write reaches TSL and WGSL materials alike (the WebGL2 build's
 *  shared-uniforms-by-reference map, in node form). */
export function buildSpikeUniforms() {
  return {
    uExposure: uniform(L_THRESH * Math.pow(10, 0.4 * DEFAULT_LIMIT_MAG)),
    uLimitMag: uniform(DEFAULT_LIMIT_MAG),
    uThresholdMag: uniform(DEFAULT_LIMIT_MAG),
    uCullMag: uniform(DEFAULT_LIMIT_MAG + 3.5),
    uMinDistSol: uniform(0),
    uMaxDistSol: uniform(50_000),
    uSpectMask: uniform(0x3ff, 'uint'),
    uHideFocusIdx: uniform(-1, 'int'),
    // Local-depth-cluster members whose core-mask stamp pins to the near
    // plane (D3 in the port contract). The app carries 8 slots; vec4i
    // keeps the spike inside one uniform (WGSL uniform arrays pad to a
    // 16-byte stride).
    uMemberIdx: uniform(new THREE.Vector4(-1, -1, -1, -1), 'ivec4'),
    uPixelRatio: uniform(1),
    uViewport: uniform(new THREE.Vector2(1920, 1080)),
    uFovYRad: uniform((60 * Math.PI) / 180),
    uSizeMin: uniform(2.592),
    uSizeMax: uniform(22),
    uSizeSpan: uniform(8),
    uSizeKnee: uniform(16),
    uDistNMin: uniform(2.2),
    uDistNMax: uniform(10.0),
    uLumBiasMin: uniform(1.0),
    uLumBiasMax: uniform(0.6),
    uVisibleThreshold: uniform(0.2),
    uVisibleK: uniform(-Math.log(0.2)),
    uCoreThreshold: uniform(0.4),
    uDiscardThreshold: uniform(0.02),
    uMaxPhysFrac: uniform(0.9),
    uRSunPc: uniform(R_SUN_PC),
    uModelDays: uniform(0),
    uModelDaysPerRealSec: uniform(1 / 86400),
    uMinPeriodSec: uniform(4),
    uDustBoundsPc: uniform(300),
    uDustDensityMin: uniform(1e-4),
    uDustLogRatio: uniform(Math.log(1000)),
    uDustAvPerDensityPc: uniform(0.5),
    uDustStrength: uniform(1),
    uWhitePoint: uniform(20),
    uHighlightDesat: uniform(0.35),
  };
}

export type SpikeUniforms = ReturnType<typeof buildSpikeUniforms>;

export interface SyntheticStars {
  count: number;
  /** xyz = position (pc, heliocentric = local frame), w = distSol. */
  posDist: Float32Array;
  /** x = absmag, y = ci (B−V), z = teffApsis (0 = none), w = log10 R_sun. */
  phot: Float32Array;
  /** x = periodDays, y = amplitudeMag, z = pulsation ρ, w = ΔB−V swing. */
  varParams: Float32Array;
  /** x = spectClass [0..9], y = lumClass, z = suppressPulsation, w = 0. */
  misc: Float32Array;
}

/** WebGPU's default maxVertexBuffers is 8 and three binds one GPU vertex
 *  buffer per BufferAttribute, so the WebGL2 build's 14 scalar instanced
 *  attributes cannot port as-is — the spike packs them into four vec4
 *  slots (aCorner + 4 instanced = 5 buffers). */
export function buildStarGeometry(stars: SyntheticStars): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'aCorner',
    new THREE.BufferAttribute(
      new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
      2,
    ),
  );
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  geometry.setAttribute('iPosDist', new THREE.InstancedBufferAttribute(stars.posDist, 4));
  geometry.setAttribute('iPhot', new THREE.InstancedBufferAttribute(stars.phot, 4));
  geometry.setAttribute('iVar', new THREE.InstancedBufferAttribute(stars.varParams, 4));
  geometry.setAttribute('iMisc', new THREE.InstancedBufferAttribute(stars.misc, 4));
  geometry.instanceCount = stars.count;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
  return geometry;
}

/** Per-pass render state, mirroring applyDiscBlendDefaults /
 *  applyGlowBlendDefaults plus the D4 core/halo split: the halo keeps the
 *  disc blend but stops writing depth, and no pass writes frag depth. */
export function applyPassState(m: THREE.NodeMaterial, pass: StarPass) {
  if (pass === PASS_CORE_MASK) {
    m.colorWrite = false;
    m.depthWrite = true;
    m.depthTest = true;
    m.blending = THREE.NoBlending;
  } else if (pass === PASS_DISC_CORE || pass === PASS_DISC_HALO) {
    m.transparent = true;
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneFactor;
    m.blendEquation = THREE.MaxEquation;
    m.premultipliedAlpha = false;
    m.depthWrite = pass === PASS_DISC_CORE;
    m.depthTest = true;
  } else {
    m.transparent = true;
    m.depthWrite = false;
    m.depthTest = true;
    m.blending = THREE.AdditiveBlending;
    m.premultipliedAlpha = false;
  }
}

export const PASS_RENDER_ORDER: Record<StarPass, number> = {
  [PASS_CORE_MASK]: -4,
  [PASS_DISC_CORE]: 0,
  [PASS_DISC_HALO]: 0.5,
  [PASS_GLOW]: 1,
};
