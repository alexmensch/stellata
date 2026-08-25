import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DUST_TINT, PARTICLE_DIM_FLOOR, PARTICLE_MAX_PX, PARTICLE_MIN_PX,
} from './dust-particle-pure';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const vert = read('./dust-particle.vert.glsl');
const frag = read('./dust-particle.frag.glsl');

/** The TSL twin imports these; GLSL cannot, so its literals are pinned
 *  here instead (`../webgpu/tsl/README.md` § TSL test pattern). */
describe('dust-particle GLSL constants match dust-particle-pure', () => {
  it('declares the sprite footprint window', () => {
    const min = vert.match(/const float MIN_PX = ([\d.]+);/);
    const max = vert.match(/const float MAX_PX = ([\d.]+);/);
    expect(min).not.toBeNull();
    expect(max).not.toBeNull();
    expect(Number(min![1])).toBe(PARTICLE_MIN_PX);
    expect(Number(max![1])).toBe(PARTICLE_MAX_PX);
  });

  it('mixes brightness up from the dim floor', () => {
    const m = vert.match(/vBrightness = mix\(([\d.]+), 1\.0, normD\)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(PARTICLE_DIM_FLOOR);
  });

  it('declares the tint', () => {
    const m = frag.match(/const vec3 DUST_TINT = vec3\(([^)]+)\);/);
    expect(m).not.toBeNull();
    const parts = m![1].split(',').map((s) => Number(s.trim()));
    expect(parts).toEqual([...DUST_TINT]);
  });
});
