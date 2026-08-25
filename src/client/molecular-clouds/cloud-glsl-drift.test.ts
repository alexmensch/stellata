import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALPHA_CAP, AV_PER_DENSITY, AV_RATE_PER_NH, AV_SATURATED, ENVELOPE_TAPER_FRAC,
  TAU_PER_AV,
} from './cloud-presence-pure';
import {
  CONTOUR_WIDTH, STIPPLE_ALPHA_FLOOR, STIPPLE_DOT_RADIUS, STIPPLE_DOT_SOFTNESS,
  STIPPLE_PERIOD_PX,
} from './cloud-rim-pure';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const absorption = read('./cloud-absorption.frag.glsl');
const rim = read('./cloud-rim.frag.glsl');

/** The number a GLSL `const float NAME = x;` declares. */
function glslConst(src: string, name: string): number {
  const m = src.match(new RegExp(`const float ${name} = ([-\\d.e]+);`));
  if (m === null) throw new Error(`${name} not declared`);
  return Number(m[1]);
}

// The TSL twins import these; GLSL cannot, so its literals are pinned here
// instead (`../webgpu/tsl/README.md` § TSL test pattern). Each of these is
// a physical or perceptual constant whose two copies silently diverging
// would give the two backends different pictures.
describe('cloud absorption GLSL constants match cloud-presence-pure', () => {
  it('pins the optical-depth and density conversions', () => {
    expect(glslConst(absorption, 'TAU_PER_AV')).toBe(TAU_PER_AV);
    expect(glslConst(absorption, 'AV_RATE_PER_NH')).toBe(AV_RATE_PER_NH);
    expect(glslConst(absorption, 'AV_PER_DENSITY')).toBe(AV_PER_DENSITY);
  });

  it('pins the opacity cap and the march cutoff', () => {
    expect(glslConst(absorption, 'ALPHA_CAP')).toBe(ALPHA_CAP);
    expect(glslConst(absorption, 'AV_SATURATED')).toBe(AV_SATURATED);
  });

  it('pins the envelope taper fraction', () => {
    const m = absorption.match(/smoothstep\(([\d.]+) \* uUEnv, uUEnv, u\)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(ENVELOPE_TAPER_FRAC);
  });
});

describe('cloud rim GLSL constants match cloud-rim-pure', () => {
  it('pins the stipple grid', () => {
    expect(glslConst(rim, 'STIPPLE_PERIOD_PX')).toBe(STIPPLE_PERIOD_PX);
    expect(glslConst(rim, 'STIPPLE_DOT_RADIUS')).toBe(STIPPLE_DOT_RADIUS);
  });

  it('pins the contour width', () => {
    expect(glslConst(rim, 'CONTOUR_WIDTH')).toBe(CONTOUR_WIDTH);
  });

  // These two are bare literals in the GLSL rather than named constants,
  // so the pin is on the expression that carries them.
  it('pins the dot softening and the alpha floor', () => {
    const soft = rim.match(/STIPPLE_DOT_RADIUS - ([\d.]+), STIPPLE_DOT_RADIUS \+ ([\d.]+)/);
    expect(soft).not.toBeNull();
    expect(Number(soft![1])).toBe(STIPPLE_DOT_SOFTNESS);
    expect(Number(soft![2])).toBe(STIPPLE_DOT_SOFTNESS);

    const floor = rim.match(/if \(a <= ([\d.]+)\) discard;/);
    expect(floor).not.toBeNull();
    expect(Number(floor![1])).toBe(STIPPLE_ALPHA_FLOOR);
  });
});
