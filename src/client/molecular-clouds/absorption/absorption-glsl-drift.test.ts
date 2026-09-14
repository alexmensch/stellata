import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALPHA_CAP, AV_PER_DENSITY, AV_RATE_PER_NH, AV_SATURATED, ENVELOPE_TAPER_FRAC,
  MARCH_MIN_CHORD_T, MARCH_MIN_STEPS, TAU_PER_AV,
} from './cloud-presence-pure';

const absorption = readFileSync(
  fileURLToPath(new URL('./cloud-absorption.frag.glsl', import.meta.url)), 'utf8');

/** The number a GLSL `const float NAME = x;` declares. */
function glslConst(src: string, name: string): number {
  const m = src.match(new RegExp(`const float ${name} = ([-\\d.e]+);`));
  if (m === null) throw new Error(`${name} not declared`);
  return Number(m[1]);
}

// The TSL twin imports these; GLSL cannot, so its literals are pinned here
// instead (`../../webgpu/tsl/README.md` § TSL test pattern). Each of these is
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

  // Bare literals in the GLSL, so the pin is on the expression carrying
  // each one. The step floor and the chord epsilon both change the picture
  // if the two backends drift apart.
  it('pins the step floor and the chord epsilon', () => {
    const clampM = absorption.match(
      /clamp\(int\(chordPc \/ max\(footprintMidPc, ([\d.e-]+)\)\), (\d+), uSteps\)/);
    expect(clampM).not.toBeNull();
    expect(Number(clampM![1])).toBe(MARCH_MIN_CHORD_T);
    expect(Number(clampM![2])).toBe(MARCH_MIN_STEPS);

    const chordM = absorption.match(/if \(t1 - t0 < ([\d.e-]+)\) discard;/);
    expect(chordM).not.toBeNull();
    expect(Number(chordM![1])).toBe(MARCH_MIN_CHORD_T);
  });
});
