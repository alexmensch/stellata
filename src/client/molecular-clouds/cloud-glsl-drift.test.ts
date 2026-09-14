import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DITHER_LSB_LEVELS, DITHER_SEED_OFFSET } from '../hdr/tonemap/tonemap-pure';
import {
  CONTOUR_WIDTH, MIN_FWIDTH, STIPPLE_ALPHA_FLOOR, STIPPLE_DOT_RADIUS,
  STIPPLE_DOT_SOFTNESS, STIPPLE_PERIOD_PX,
} from './cloud-rim-pure';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const absorption = read('./absorption/cloud-absorption.frag.glsl');
const rim = read('./cloud-rim.frag.glsl');

/** The number a GLSL `const float NAME = x;` declares. */
function glslConst(src: string, name: string): number {
  const m = src.match(new RegExp(`const float ${name} = ([-\\d.e]+);`));
  if (m === null) throw new Error(`${name} not declared`);
  return Number(m[1]);
}

// The dither is one shape across both cloud shaders and the resolve, so its
// seed offset and its 8-bit divisor are pinned from the module that owns
// them rather than per shader.
describe('the cloud dither matches hdr/tonemap/tonemap-pure', () => {
  for (const [name, src] of [['absorption', absorption], ['rim', rim]] as const) {
    it(`pins the ${name} shader's seed offset and divisor`, () => {
      const m = src.match(
        /stellataIgn\(gl_FragCoord\.xy \+ ([\d.]+)\) - 0\.5\) \/ ([\d.]+);/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBe(DITHER_SEED_OFFSET);
      expect(Number(m![2])).toBe(DITHER_LSB_LEVELS);
    });
  }
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

  it('pins the fwidth floor', () => {
    const m = rim.match(/max\(fwidth\(ndotv\), ([\d.e-]+)\)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(MIN_FWIDTH);
  });
});

// Ink density varying with distance would break the flat printed-atlas
// convention, so the camera-distance attenuation is excluded from chart
// mode — by the chart arm returning before it, not by a condition that
// would look load-bearing and is not.
describe('the chart-mode stipple takes no camera-distance attenuation', () => {
  it('reaches the shared term only after the chart branch returns', () => {
    const chartArm = rim.slice(0, rim.indexOf('return;'));
    expect(chartArm).not.toContain('shellDistanceAttenuation');
    expect(rim).toContain('shellDistanceAttenuation(dView');
  });
});
