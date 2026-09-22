// The blend states the star passes and every emitter sharing their look
// apply.

import * as THREE from 'three';

export function applyDiscBlendDefaults(m: THREE.Material) {
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendEquation = THREE.MaxEquation;
  m.premultipliedAlpha = false;
  m.depthWrite = true;
  m.depthTest = true;
}

export function applyGlowBlendDefaults(m: THREE.Material) {
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.blending = THREE.AdditiveBlending;
  m.premultipliedAlpha = false;
}

// `premultipliedAlpha` is load-bearing, not cosmetic: three.js REFUSES
// MultiplyBlending without it, and the refusal is silent-ish — it logs,
// issues no blendFunc at all, then caches the swap as applied so it
// never retries. The draw inherits whatever blend func the previous
// material left, which is why the symptom is order-dependent (correct
// entering chart on load, white discs toggling in) rather than a
// consistent failure.
export function applyMonochromeBlend(m: THREE.Material) {
  m.blending = THREE.MultiplyBlending;
  m.premultipliedAlpha = true;
  m.depthWrite = false;
  m.depthTest = false;
}

/**
 * The disc + glow pair's whole chart-mode swap, both directions.
 * `discDefaults` is a parameter because the TSL disc must come back with
 * `depthWrite` off (`../webgpu/star/star-disc-tsl.ts`), which
 * `applyDiscBlendDefaults` alone does not give it.
 *
 * Both materials need `needsUpdate` — the blend state is compiled into
 * the program, and a swap that skips it renders with the previous mode's
 * blending.
 */
export function applyChartBlendSwap(
  disc: THREE.Material,
  glow: THREE.Material,
  on: boolean,
  discDefaults: (m: THREE.Material) => void,
) {
  if (on) {
    applyMonochromeBlend(disc);
    applyMonochromeBlend(glow);
  } else {
    discDefaults(disc);
    applyGlowBlendDefaults(glow);
  }
  disc.needsUpdate = true;
  glow.needsUpdate = true;
}
