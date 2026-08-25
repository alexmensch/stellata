import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  applyChartBlendSwap,
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

// The pair swap both backends take. `discDefaults` is the only argument
// because it is the only thing that differs: the GLSL disc restores
// depthWrite, the TSL disc must not (../webgpu/star/star-disc-tsl.ts).
describe('applyChartBlendSwap', () => {
  const pair = () => ({
    disc: new THREE.ShaderMaterial({}),
    glow: new THREE.ShaderMaterial({}),
  });

  it('takes both materials into ink, and flags both for recompile', () => {
    const { disc, glow } = pair();
    disc.needsUpdate = false;
    glow.needsUpdate = false;
    applyChartBlendSwap(disc, glow, true, applyDiscBlendDefaults);
    for (const m of [disc, glow]) {
      expect(m.blending).toBe(THREE.MultiplyBlending);
      expect(m.premultipliedAlpha).toBe(true);
      expect(m.version).toBeGreaterThan(0);
    }
  });

  it('restores the glow default and defers the disc to its argument', () => {
    const { disc, glow } = pair();
    applyChartBlendSwap(disc, glow, true, applyDiscBlendDefaults);
    applyChartBlendSwap(disc, glow, false, applyDiscBlendDefaults);
    expect(disc.blending).toBe(THREE.CustomBlending);
    expect(disc.depthWrite).toBe(true);
    expect(glow.blending).toBe(THREE.AdditiveBlending);
  });

  // The TSL disc's depthWrite override is the whole reason the helper is
  // parameterised rather than hardcoding applyDiscBlendDefaults: losing
  // it on swap-back puts the halo's depth write back and defeats early-z.
  it('honours a disc-defaults argument that overrides the shared helper', () => {
    const { disc, glow } = pair();
    const tslDefaults = (m: THREE.Material) => {
      applyDiscBlendDefaults(m);
      m.depthWrite = false;
    };
    applyChartBlendSwap(disc, glow, true, tslDefaults);
    applyChartBlendSwap(disc, glow, false, tslDefaults);
    expect(disc.blending).toBe(THREE.CustomBlending);
    expect(disc.blendEquation).toBe(THREE.MaxEquation);
    expect(disc.depthWrite).toBe(false);
  });
});
