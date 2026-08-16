import { describe, it, expect } from 'vitest';
import { resolveStarPickVisibility } from './star-pick-visibility-pure';
import type { RenderedSizeComponents } from './star-physics';
import { exposureForMagLimit } from '../../hdr/exposure/exposure-epoch';

// A comfortably-visible naked-eye star: glow-dominant (physSize far
// under half the quad), a few magnitudes inside the threshold.
const LIMIT_MAG = 6.5;
function components(over: Partial<RenderedSizeComponents> = {}): RenderedSizeComponents {
  return {
    appMag: 2,
    appSizePx: 8,
    physSizePx: 1e-4,
    physSizePxUncapped: 1e-4,
    ...over,
  };
}

function args(over: Record<string, unknown> = {}) {
  return {
    focalHidden: false,
    eclipseDim: 1,
    chartDiscPx: null,
    limitMag: LIMIT_MAG,
    components: components(),
    exposure: exposureForMagLimit(LIMIT_MAG),
    thresholdMag: LIMIT_MAG,
    whitePoint: 1,
    ...over,
  } as Parameters<typeof resolveStarPickVisibility>[0];
}

describe('resolveStarPickVisibility / baseline', () => {
  it('a bright glow-dominant star is visible with a non-zero hit radius', () => {
    const r = resolveStarPickVisibility(args());
    expect(r.visible).toBe(true);
    expect(r.hitRadius).toBeGreaterThan(0);
  });
});

// uHideFocusIdx collapses the focal star's quad in every pass while the
// camera is parked at it in OBSERVE — one star, drawn nowhere, sitting
// dead centre of the screen and previously fully pickable.
describe('resolveStarPickVisibility / focal-hide sentinel', () => {
  it('is unpickable while hidden, in the realistic path', () => {
    expect(resolveStarPickVisibility(args({ focalHidden: true })).visible).toBe(false);
  });

  it('is unpickable while hidden in chart mode too — the shader gate is', () => {
    // ...unconditional on uRenderMode, so the chart branch must not
    // short-circuit past it.
    const hidden = args({ focalHidden: true, chartDiscPx: 12 });
    const shown = args({ chartDiscPx: 12 });
    expect(resolveStarPickVisibility(hidden).visible).toBe(false);
    expect(resolveStarPickVisibility(shown).visible).toBe(true);
  });

  it('reports a zero hit radius when hidden', () => {
    expect(resolveStarPickVisibility(args({ focalHidden: true })).hitRadius).toBe(0);
  });
});

describe('resolveStarPickVisibility / eclipse dim', () => {
  it('totality collapses the quad, so the back component is unpickable', () => {
    expect(resolveStarPickVisibility(args({ eclipseDim: 0 })).visible).toBe(false);
  });

  it('a partial dim is a magnitude penalty, not a collapse', () => {
    // 0.5 of the disc occluded = +0.75 mag; a mag-2 star survives it.
    expect(resolveStarPickVisibility(args({ eclipseDim: 0.5 })).visible).toBe(true);
  });

  it('a deep partial dim can still push a marginal star past the ink floor', () => {
    const marginal = components({ appMag: LIMIT_MAG });
    expect(resolveStarPickVisibility(
      args({ components: marginal }),
    ).visible).toBe(true);
    expect(resolveStarPickVisibility(
      args({ components: marginal, eclipseDim: 0.001 }),
    ).visible).toBe(false);
  });

  // star.vert.glsl gates the dim on uRenderMode == 0. A resolved pair
  // orders geometrically in the local depth pass, and its discs keep
  // drawing — mirroring the dim here would hide a star that is on screen.
  it('leaves a disc-dominant star pickable at totality', () => {
    // Same star, same magnitude — only the pass split differs.
    const bright = { appMag: -10, appSizePx: 12 };
    const resolved = components({ ...bright, physSizePx: 40, physSizePxUncapped: 40 });
    const unresolved = components({ ...bright, physSizePx: 1e-4, physSizePxUncapped: 1e-4 });
    expect(resolveStarPickVisibility(
      args({ components: resolved, eclipseDim: 0 }),
    ).visible).toBe(true);
    expect(resolveStarPickVisibility(
      args({ components: unresolved, eclipseDim: 0 }),
    ).visible).toBe(false);
  });
});

describe('resolveStarPickVisibility / adaptation', () => {
  // uExposure carries the per-frame adaptation cut. A parked planet drives
  // it deep enough to black out the faint end; the pick gate has to follow.
  it('a threshold star drops out of the pick set once the scene adapts down', () => {
    const threshold = components({ appMag: LIMIT_MAG });
    const open = exposureForMagLimit(LIMIT_MAG);
    expect(resolveStarPickVisibility(
      args({ components: threshold, exposure: open }),
    ).visible).toBe(true);
    // dm = -3 mag of adaptation cut.
    expect(resolveStarPickVisibility(
      args({ components: threshold, exposure: open * 10 ** (-0.4 * 3) }),
    ).visible).toBe(false);
  });
});
