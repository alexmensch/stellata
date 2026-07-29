import { describe, expect, it } from 'vitest';
import { solFrameFadeFactor } from './galactic-fade';
import { EQUATORIAL_FADE_WINDOW_PC, equatorialSphereReachable } from './equatorial-sphere';

const ALPHA_CEN_PC = 1.34;
// Neptune's semi-major axis, as a stand-in for "still inside the planets".
const NEPTUNE_PC = 30.07 / 206_264.8;

describe('EQUATORIAL_FADE_WINDOW_PC', () => {
  it('is the sub-parsec-to-a-few-parsecs window sp4q derived', () => {
    expect(EQUATORIAL_FADE_WINDOW_PC).toEqual({ innerPc: 0.4, outerPc: 2.0 });
  });

  it('holds the sphere at full strength across the solar system', () => {
    expect(solFrameFadeFactor(NEPTUNE_PC, EQUATORIAL_FADE_WINDOW_PC)).toBe(1);
  });

  // An Earth-referenced frame has to be mostly gone by the nearest star; the
  // whole reason it fades is that it stops describing anyone's sky out there.
  it('has faded most of the way out by α Cen', () => {
    expect(solFrameFadeFactor(ALPHA_CEN_PC, EQUATORIAL_FADE_WINDOW_PC)).toBeLessThan(0.5);
  });
});

describe('equatorialSphereReachable', () => {
  it('holds inside the window and fails at or past the outer edge', () => {
    expect(equatorialSphereReachable(0)).toBe(true);
    expect(equatorialSphereReachable(EQUATORIAL_FADE_WINDOW_PC.innerPc)).toBe(true);
    expect(equatorialSphereReachable(ALPHA_CEN_PC)).toBe(true);
    expect(equatorialSphereReachable(EQUATORIAL_FADE_WINDOW_PC.outerPc)).toBe(false);
    expect(equatorialSphereReachable(1e6)).toBe(false);
  });

  // The `S` cycle and the panel stop both gate on this, so it must never call a
  // sphere reachable that the layer would then decline to draw.
  it('agrees with the layer’s own visibility cut', () => {
    for (const d of [0, 0.2, 0.4, 1, 1.9, 2, 2.1, 10]) {
      expect(equatorialSphereReachable(d))
        .toBe(solFrameFadeFactor(d, EQUATORIAL_FADE_WINDOW_PC) > 0);
    }
  });
});
