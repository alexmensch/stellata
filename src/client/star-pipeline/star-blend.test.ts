import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  applyChartBlendSwap,
  applyDiscBlendDefaults,
  applyGlowBlendDefaults,
  applyMonochromeBlend,
} from './star-blend';

describe('applyDiscBlendDefaults', () => {
  const makeMaterial = () => new THREE.MeshBasicMaterial();

  it('writes the four CustomBlending fields, and tests depth without writing it', () => {
    const m = makeMaterial();
    applyDiscBlendDefaults(m);
    expect(m.blending).toBe(THREE.CustomBlending);
    expect(m.blendSrc).toBe(THREE.OneFactor);
    expect(m.blendDst).toBe(THREE.OneFactor);
    expect(m.blendEquation).toBe(THREE.MaxEquation);
    expect(m.premultipliedAlpha).toBe(false);
    expect(m.depthWrite).toBe(false);
    expect(m.depthTest).toBe(true);
  });

  it('overwrites whatever was on the material before', () => {
    const m = makeMaterial();
    // Simulate the chart-mode swap-out that puts the disc material into
    // MultiplyBlending with depth off — the toggle-back must restore the
    // colour-mode defaults.
    m.blending = THREE.MultiplyBlending;
    m.depthWrite = true;
    m.depthTest = false;
    applyDiscBlendDefaults(m);
    expect(m.blending).toBe(THREE.CustomBlending);
    expect(m.depthWrite).toBe(false);
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

describe('applyMonochromeBlend', () => {
  const makeMaterial = () => new THREE.MeshBasicMaterial();

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

describe('applyChartBlendSwap', () => {
  const pair = () => ({
    disc: new THREE.MeshBasicMaterial(),
    glow: new THREE.MeshBasicMaterial(),
  });

  it('takes both materials into ink, and flags both for recompile', () => {
    const { disc, glow } = pair();
    disc.needsUpdate = false;
    glow.needsUpdate = false;
    applyChartBlendSwap(disc, glow, true);
    for (const m of [disc, glow]) {
      expect(m.blending).toBe(THREE.MultiplyBlending);
      expect(m.premultipliedAlpha).toBe(true);
      expect(m.version).toBeGreaterThan(0);
    }
  });

  // Losing the disc's depthWrite = false on swap-back would put the halo's
  // depth write back and cost all three pipelines their early-z.
  it('restores both colour-mode defaults on the way back', () => {
    const { disc, glow } = pair();
    applyChartBlendSwap(disc, glow, true);
    applyChartBlendSwap(disc, glow, false);
    expect(disc.blending).toBe(THREE.CustomBlending);
    expect(disc.blendEquation).toBe(THREE.MaxEquation);
    expect(disc.depthWrite).toBe(false);
    expect(glow.blending).toBe(THREE.AdditiveBlending);
  });
});
