// coverage.frag.glsl re-declares every number and every formula in
// coverage-pure.ts, and none of it is reachable from vitest (no GL context).
// Pinning the literals and the expression shapes is the only compile-time-ish
// tie between the two sides.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CLEAR_DEPTH_EPS,
  COVERAGE_MAX_RINGS,
  COVERAGE_TAPS,
  GOLDEN_ANGLE,
  RING_MIN_SIN_OPENING,
  SELF_OCCLUSION_SLACK,
} from './coverage-pure';

const chunk = readFileSync(
  fileURLToPath(new URL('./coverage.frag.glsl', import.meta.url)), 'utf8');

function constant(name: string, type: 'float' | 'int'): number {
  const m = chunk.match(new RegExp(`const ${type} ${name} = ([^;]+);`));
  if (m === null) throw new Error(`${name} not declared in coverage.frag.glsl`);
  return Number(m[1]);
}

describe('coverage.frag.glsl constants', () => {
  it('declares the same numbers as coverage-pure', () => {
    expect(constant('COVERAGE_TAPS', 'int')).toBe(COVERAGE_TAPS);
    expect(constant('GOLDEN_ANGLE', 'float')).toBeCloseTo(GOLDEN_ANGLE, 12);
    expect(constant('SELF_OCCLUSION_SLACK', 'float')).toBe(SELF_OCCLUSION_SLACK);
    expect(constant('CLEAR_DEPTH_EPS', 'float')).toBe(CLEAR_DEPTH_EPS);
    expect(constant('RING_MIN_SIN_OPENING', 'float')).toBe(RING_MIN_SIN_OPENING);
    expect(constant('COVERAGE_MAX_RINGS', 'int')).toBe(COVERAGE_MAX_RINGS);
  });

  it('carries the golden angle to enough digits to keep the tap set equal-area', () => {
    // Truncating it walks the spiral off equal-area over 64 taps, which
    // biases the fraction with no other symptom.
    expect(Math.abs(constant('GOLDEN_ANGLE', 'float') - GOLDEN_ANGLE)).toBeLessThan(1e-15);
  });

  it('unrolls one ring slot per COVERAGE_MAX_RINGS, since GLSL cannot index samplers', () => {
    for (let i = 0; i < COVERAGE_MAX_RINGS; i++) {
      expect(chunk).toContain(`uniform sampler2D uRingStrip${i};`);
      expect(chunk).toContain(`uRingStrip${i}, uRingCentre[${i}], uRingPole[${i}]`);
    }
    expect(chunk).not.toContain(`uRingStrip${COVERAGE_MAX_RINGS}`);
  });
});

describe('coverage.frag.glsl formulas', () => {
  it('inverts the projection the same way viewDistanceFromDepth does', () => {
    expect(chunk).toContain('float zNdc = 2.0 * depth01 - 1.0;');
    expect(chunk).toContain(
      'return (2.0 * far * near) / ((far + near) - zNdc * (far - near));');
  });

  it('runs the clear-texel guard BEFORE the distance compare', () => {
    // A cleared texel decodes to the far plane, which is nearer than any
    // source beyond the bracket — reversed, every background star reads as
    // fully occluded.
    const body = chunk.slice(chunk.indexOf('bool tapOccluded('));
    expect(body.indexOf('CLEAR_DEPTH_EPS')).toBeLessThan(body.indexOf('viewDistanceFromDepth'));
  });

  it('compares in view-axis depth, never radial distance', () => {
    // distPc arrives radial; the depth buffer is axial. Off-axis the two
    // differ by orders more than the slack allows.
    expect(chunk).toContain('float sourceDepthPc = distPc / length(centreRay);');
    expect(chunk).toContain('sourceDepthPc * rayLen');
  });

  it('takes the slack from the source own footprint, floored relatively', () => {
    expect(chunk).toContain(
      'max(radiusPx / uPxPerRadian, SELF_OCCLUSION_SLACK) * sourceDepthPc');
  });

  it('raises 1 - alpha to the slant path, matching ringTransmission', () => {
    expect(chunk).toContain(
      'pow(1.0 - a, 1.0 / max(abs(sinOpeningAngle), RING_MIN_SIN_OPENING))');
  });

  it('drops an out-of-frame tap from both sides of the mean', () => {
    const loop = chunk.slice(chunk.indexOf('for (int k = 0'));
    expect(loop.indexOf('greaterThan(uv, vec2(1.0))')).toBeLessThan(loop.indexOf('n += 1.0'));
    expect(loop.indexOf('n += 1.0')).toBeLessThan(loop.indexOf('tapOccluded('));
    expect(chunk).toContain('n > 0.0 ? sum / n : 1.0');
  });
});
