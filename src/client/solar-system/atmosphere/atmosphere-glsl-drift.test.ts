// atmosphere-scatter.glsl duplicates constants and expression shapes from
// atmosphere-scattering-pure.ts with nothing at compile time tying the two
// sides together. No GL context in vitest, so pin the source text.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MS_STRENGTH } from './atmosphere-scattering-pure';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

const scatter = read('./atmosphere-scatter.glsl');

function glslFloat(src: string, name: string): number {
  const m = src.match(new RegExp(`const float ${name} = ([-\\d.e]+);`));
  if (m === null) throw new Error(`${name} not declared`);
  return Number(m[1]);
}

describe('constants mirrored from the CPU model', () => {
  it('multiple-scattering fill weight', () => {
    expect(glslFloat(scatter, 'STELLATA_MS_STRENGTH')).toBe(MS_STRENGTH);
  });

});

describe('the airlight has no gain', () => {
  it('accumulates the multiple-scattering fill without scaling single scatter', () => {
    // The integrator's output is already a fraction of host irradiance, and
    // uAirlightLuminance carries that irradiance, so any surviving scalar
    // here is a display fudge on a physical quantity.
    expect(scatter).toContain('inscatter += ms;');
    expect(scatter).not.toMatch(/AIRLIGHT_GAIN/);
  });
});

describe('the shadow is solved along the ray, not sampled across it', () => {
  it('cuts the cylinder quadratic against the terminator half-space', () => {
    expect(scatter).toContain('float disc = b * b - a * c;');
    expect(scatter).toContain('if (dS > 0.0) hi = min(hi, th); else lo = max(lo, th);');
  });

  it('keeps the sunward-of-the-terminator escape, which the cylinder alone misses', () => {
    // Points inside the cylinder by impact parameter but in FRONT of the body
    // are lit; dropping this branch shadows the whole day side.
    expect(scatter).toContain('} else if (oS >= 0.0) {');
  });

  it('holds the parallel-ray case, where the impact parameter never changes', () => {
    expect(scatter).toContain('if (c >= 0.0) return;');
    expect(scatter).toContain('lo = -STELLATA_SHADOW_FAR;');
  });

  it('weights each sample by its segment’s coverage, at half the march step', () => {
    expect(scatter).toContain(
      'float overlap = max(min(t + h, s1) - max(t - h, s0), 0.0);');
    expect(scatter).toContain('return 1.0 - overlap / (2.0 * h);');
    expect(scatter).toContain(
      'float lit = stellata_litFraction(t, 0.5 * segLen, shadow0, shadow1);');
  });

  it('solves the span once per ray, outside the march', () => {
    // Inside the loop it would still be exact, just ATMO_N_VIEW× the cost.
    const spanCall = scatter.indexOf('stellata_shadowSpan(o, d, sunDir, shadow0, shadow1);');
    const loop = scatter.indexOf('for (int i = 0; i < ATMO_N_VIEW; i++)');
    expect(spanCall).toBeGreaterThan(0);
    expect(spanCall).toBeLessThan(loop);
  });

  it('carries no fixed shadow-softness constant any more', () => {
    expect(scatter).not.toMatch(/SHADOW_SOFT[^_]/);
  });
});
