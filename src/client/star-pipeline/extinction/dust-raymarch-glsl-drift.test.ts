import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DUST_TAPS_MAX, DUST_TAPS_MIN, DUST_TAP_PC, SLAB_PARALLEL_EPS_PC,
} from './dust-raymarch-pure';

const glsl = readFileSync(
  fileURLToPath(new URL('./dust-raymarch.glsl', import.meta.url)), 'utf8');

function constant(type: string, name: string): number {
  const m = glsl.match(new RegExp(`const ${type} ${name} = ([-\\d.e]+);`));
  expect(m, `${name} declared in dust-raymarch.glsl`).not.toBeNull();
  return Number(m![1]);
}

// ../../webgpu/tsl/README.md § TSL test pattern, leg 1.
describe('dust-raymarch GLSL constants match dust-raymarch-pure', () => {
  it('declares the tap density and its clamp', () => {
    expect(constant('float', 'DUST_TAP_PC')).toBe(DUST_TAP_PC);
    expect(constant('int', 'DUST_TAPS_MIN')).toBe(DUST_TAPS_MIN);
    expect(constant('int', 'DUST_TAPS_MAX')).toBe(DUST_TAPS_MAX);
  });

  it('declares the slab-parallel epsilon', () => {
    expect(constant('float', 'SLAB_PARALLEL_EPS_PC')).toBe(SLAB_PARALLEL_EPS_PC);
  });
});
