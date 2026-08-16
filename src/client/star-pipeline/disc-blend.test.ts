import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  applyDiscBlendDefaults,
  applyGlowBlendDefaults,
  applyMonochromeBlend,
} from './star-pipeline';

// Pin the disc-pass blend equation across the helper's lifecycle.
// PR #25 had to update two parallel sites for the AddEquation →
// MaxEquation switch (constructor + chart-mode swap-back). The helper
// now owns both; this test guards against future drift between the
// constructor's intent and what ends up on the material after a
// chart-mode toggle.
describe('applyDiscBlendDefaults', () => {
  function makeMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({});
  }

  it('writes the four CustomBlending fields + depth flags', () => {
    const m = makeMaterial();
    applyDiscBlendDefaults(m);
    expect(m.blending).toBe(THREE.CustomBlending);
    expect(m.blendSrc).toBe(THREE.OneFactor);
    expect(m.blendDst).toBe(THREE.OneFactor);
    expect(m.blendEquation).toBe(THREE.MaxEquation);
    expect(m.premultipliedAlpha).toBe(false);
    expect(m.depthWrite).toBe(true);
    expect(m.depthTest).toBe(true);
  });

  it('overwrites whatever was on the material before', () => {
    const m = makeMaterial();
    // Simulate the chart-mode swap-out that puts the disc material into
    // MultiplyBlending with depth off — the toggle-back must restore the
    // colour-mode defaults.
    m.blending = THREE.MultiplyBlending;
    m.depthWrite = false;
    m.depthTest = false;
    applyDiscBlendDefaults(m);
    expect(m.blending).toBe(THREE.CustomBlending);
    expect(m.depthWrite).toBe(true);
    expect(m.depthTest).toBe(true);
  });

  it('is idempotent: re-applying yields the same field values', () => {
    const m = makeMaterial();
    applyDiscBlendDefaults(m);
    const snap1 = {
      b: m.blending, s: m.blendSrc, d: m.blendDst, e: m.blendEquation,
      dw: m.depthWrite, dt: m.depthTest,
    };
    applyDiscBlendDefaults(m);
    const snap2 = {
      b: m.blending, s: m.blendSrc, d: m.blendDst, e: m.blendEquation,
      dw: m.depthWrite, dt: m.depthTest,
    };
    expect(snap2).toEqual(snap1);
  });
});

// three.js REFUSES MultiplyBlending on a material with
// premultipliedAlpha = false: it logs, issues no blendFunc at all, and
// still caches the swap as applied, so the draw silently inherits the
// previous material's blend state. That shipped as chart-mode star discs
// rendering white when chart was toggled on from observe, while entering
// chart directly on load happened to inherit a benign state.
describe('applyMonochromeBlend', () => {
  function makeMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({});
  }

  it('sets premultipliedAlpha alongside MultiplyBlending', () => {
    const m = makeMaterial();
    applyMonochromeBlend(m);
    expect(m.blending).toBe(THREE.MultiplyBlending);
    expect(m.premultipliedAlpha).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.depthTest).toBe(false);
  });

  it('round-trips through both defaults appliers', () => {
    // The chart toggle runs this cycle on every entry and exit; neither
    // direction may leave premultipliedAlpha disagreeing with blending.
    for (const restore of [applyDiscBlendDefaults, applyGlowBlendDefaults]) {
      const m = makeMaterial();
      applyMonochromeBlend(m);
      restore(m);
      expect(m.premultipliedAlpha).toBe(false);
      expect(m.blending).not.toBe(THREE.MultiplyBlending);
      applyMonochromeBlend(m);
      expect(m.premultipliedAlpha).toBe(true);
      expect(m.blending).toBe(THREE.MultiplyBlending);
    }
  });
});
