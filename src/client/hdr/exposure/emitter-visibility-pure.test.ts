import { describe, expect, it } from 'vitest';
import {
  EIGHT_BIT_HALF_STEP,
  emitterPeakDisplayLevel,
  emitterPutsInkOnScreen,
  taperFactor,
  type EmitterInkArgs,
} from './emitter-visibility-pure';
import { sceneExposure, thresholdMagFor } from './exposure-epoch';
import { DR_MAG, tonemapWhitePoint } from '../tonemap-pure';
import { SOFT_TAPER_MARGIN_MAG } from '../../solar-system/perceptual-magnitude';
import { DEFAULT_INSTRUMENT, instrumentLimitMag } from '../../filters/filter-state';

const LIMIT = instrumentLimitMag(DEFAULT_INSTRUMENT);
const WHITE = tonemapWhitePoint(DR_MAG);

function star(overrides: Partial<EmitterInkArgs> = {}): EmitterInkArgs {
  const thresholdMag = thresholdMagFor(LIMIT, 0);
  return {
    appMag: thresholdMag,
    exposure: sceneExposure(LIMIT, 0, 0),
    thresholdMag,
    physRadiusPx: 0,
    whitePoint: WHITE,
    tapered: true,
    ...overrides,
  };
}

/** Smallest magnitudes-past-threshold at which the emitter stops
 *  putting ink on screen, to 1e-4 mag. */
function inkEdgeMagPastThreshold(base: EmitterInkArgs): number {
  let lo = -20;
  let hi = SOFT_TAPER_MARGIN_MAG;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const lit = emitterPutsInkOnScreen({ ...base, appMag: base.thresholdMag + mid });
    if (lit) lo = mid; else hi = mid;
  }
  return hi;
}

describe('taperFactor', () => {
  it('mirrors the glow pass smoothstep across the taper band', () => {
    expect(taperFactor(7.8, 7.8, true)).toBe(1);
    expect(taperFactor(7.8 + SOFT_TAPER_MARGIN_MAG / 2, 7.8, true)).toBeCloseTo(0.5, 12);
    expect(taperFactor(7.8 + SOFT_TAPER_MARGIN_MAG, 7.8, true)).toBe(0);
    expect(taperFactor(9, 7.8, true)).toBe(0);
  });

  it('hard-cuts at the threshold for disc-dominated emitters', () => {
    expect(taperFactor(7.8, 7.8, false)).toBe(1);
    expect(taperFactor(7.80001, 7.8, false)).toBe(0);
  });
});

describe('emitterPeakDisplayLevel', () => {
  // hdr/README.md § Operator: "L = L_THRESH resolves to 0.15 of full
  // scale after encode". A source at the threshold carries exactly
  // L_THRESH by construction, so this pins the whole chain end to end.
  it('puts a threshold source at 0.15 of full scale on an unadapted frame', () => {
    expect(emitterPeakDisplayLevel(star())).toBeCloseTo(0.15001, 5);
  });

  it('spreads a resolved disc over its area, dimming the peak', () => {
    const point = emitterPeakDisplayLevel(star());
    const resolved = emitterPeakDisplayLevel(star({ physRadiusPx: 10 }));
    expect(resolved).toBeLessThan(point);
  });
});

describe('emitterPutsInkOnScreen — the pick gate the shipped cutoff misses', () => {
  // The bug: drawCutoffMag admits stars out to threshold + 0.5, where
  // the taper is exactly zero. Nothing in the last stretch renders.
  it('renders nothing at the shipped draw cutoff', () => {
    const s = star();
    expect(
      emitterPeakDisplayLevel({ ...s, appMag: s.thresholdMag + SOFT_TAPER_MARGIN_MAG }),
    ).toBe(0);
    expect(
      emitterPutsInkOnScreen({ ...s, appMag: s.thresholdMag + SOFT_TAPER_MARGIN_MAG }),
    ).toBe(false);
  });

  it('goes dark well before the shipped cutoff, and that gap is the bug', () => {
    const edge = inkEdgeMagPastThreshold(star());
    expect(edge).toBeLessThan(SOFT_TAPER_MARGIN_MAG);
    expect(edge).toBeCloseTo(0.3066, 4);
  });

  // Dust: the picker's magnitude is intrinsic, the shader's is extincted.
  it('drops a threshold star behind one magnitude of dust', () => {
    const s = star();
    expect(emitterPutsInkOnScreen(s)).toBe(true);
    expect(emitterPutsInkOnScreen({ ...s, appMag: s.thresholdMag + 1 })).toBe(false);
  });

  // Adaptation: uThresholdMag excludes dm, uExposure carries it.
  it('drops the whole faint end once the frame adapts', () => {
    const thresholdMag = thresholdMagFor(LIMIT, 0);
    const adapted = (dm: number) =>
      emitterPutsInkOnScreen(star({ exposure: sceneExposure(LIMIT, dm, 0), thresholdMag }));
    expect(adapted(0)).toBe(true);
    expect(adapted(-1)).toBe(true);
    expect(adapted(-2)).toBe(false);
    expect(adapted(-14)).toBe(false);
  });

  it('lets the EV trim reveal a star the unadapted frame hides', () => {
    const dim = star({ appMag: thresholdMagFor(LIMIT, 0) + 0.45 });
    expect(emitterPutsInkOnScreen(dim)).toBe(false);
    const trimmed = thresholdMagFor(LIMIT, 3);
    expect(
      emitterPutsInkOnScreen({
        ...dim,
        exposure: sceneExposure(LIMIT, 0, 3),
        thresholdMag: trimmed,
      }),
    ).toBe(true);
  });

  it('is exactly the half-step comparison, with no hidden margin', () => {
    const s = star();
    const edge = inkEdgeMagPastThreshold(s);
    const justLit = emitterPeakDisplayLevel({ ...s, appMag: s.thresholdMag + edge - 1e-3 });
    expect(justLit).toBeGreaterThanOrEqual(EIGHT_BIT_HALF_STEP);
  });
});
