// The blend states the star passes and every emitter sharing their look
// apply.

import * as THREE from 'three';

// No depth write: the core mask already stamped every core, and a halo
// must not write at all — ../webgpu/star/README.md#the-disc-draw-writes-no-depth.
export function applyDiscBlendDefaults(m: THREE.Material) {
  m.transparent = true;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendEquation = THREE.MaxEquation;
  m.premultipliedAlpha = false;
  m.depthWrite = false;
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

/** Both materials need `needsUpdate` — the blend state is compiled into
 *  the pipeline, and a swap that skips it renders with the previous mode's
 *  blending. */
export function applyChartBlendSwap(disc: THREE.Material, glow: THREE.Material, on: boolean) {
  if (on) {
    applyMonochromeBlend(disc);
    applyMonochromeBlend(glow);
  } else {
    applyDiscBlendDefaults(disc);
    applyGlowBlendDefaults(glow);
  }
  disc.needsUpdate = true;
  glow.needsUpdate = true;
}
