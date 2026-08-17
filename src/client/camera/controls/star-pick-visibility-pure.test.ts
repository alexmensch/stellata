import { describe, it, expect } from 'vitest';
import {
  resolveStarPickVisibility,
  type StarPickVisibilityArgs,
} from './star-pick-visibility-pure';
import { appSizePxForMag, type RenderedSizeComponents } from './star-physics';
import { DEFAULT_FILTER, STAR_RENDER_DEFAULTS } from '../../filters/filter-state';
import { exposureForMagLimit } from '../../hdr/exposure/exposure-epoch';

// A comfortably-visible naked-eye star: glow-dominant (physSize far
// under half the quad), a few magnitudes inside the threshold.
const LIMIT_MAG = 6.5;

// `discHitRadiusPx` floors at MIN_DISC_HIT_RADIUS_PX, so a quad under
// 2 x that floor has no observable radius at all — which is every
// glow-dominant star at DEFAULT_FILTER's placeholder sizeMax. The derived
// sizeMax passes it in the PSF-dominated regime and under the star-size
// exaggeration multiplier, and that is the only regime where the eclipse
// dim can move a hit radius.
const BIG_QUAD_FILTER = { ...DEFAULT_FILTER, sizeMin: 2, sizeMax: 40 };
// The production curve rather than a stand-in, so the dim-shrinks-the-quad
// cases below pin what the shader actually draws.
const appSize = (m: number) => appSizePxForMag(m, BIG_QUAD_FILTER, STAR_RENDER_DEFAULTS.sizeKnee);

function components(over: Partial<RenderedSizeComponents> = {}): RenderedSizeComponents {
  return {
    appMag: 2,
    appSizePx: appSize(2),
    physSizePx: 1e-4,
    physSizePxUncapped: 1e-4,
    ...over,
  };
}

function args(over: Partial<StarPickVisibilityArgs> = {}): StarPickVisibilityArgs {
  return {
    focalHidden: false,
    eclipseDim: 1,
    chartDiscPx: null,
    limitMag: LIMIT_MAG,
    components: components(),
    appSizePxForMag: appSize,
    exposure: exposureForMagLimit(LIMIT_MAG),
    thresholdMag: LIMIT_MAG,
    whitePoint: 1,
    ...over,
  };
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

  // The shader folds the dim into appMag before deriving pxSize, so the
  // quad shrinks as well as fading. Without the re-solve the pick kept its
  // undimmed reach and clicks landed outside the drawn footprint.
  it('shrinks the hit radius with the dim, not just the brightness', () => {
    const undimmed = resolveStarPickVisibility(args()).hitRadius;
    const dimmed = resolveStarPickVisibility(args({ eclipseDim: 0.05 })).hitRadius;
    expect(dimmed).toBeLessThan(undimmed);
    expect(dimmed).toBeGreaterThan(0);
  });

  it('leaves the hit radius alone when nothing is dimming the star', () => {
    // eclipseDim = 1 must not route through the re-solve at all: the
    // components' own appSizePx is what the frame drew.
    const r = resolveStarPickVisibility(
      args({ appSizePxForMag: () => { throw new Error('must not re-solve at dim = 1'); } }),
    );
    expect(r.hitRadius).toBeGreaterThan(0);
  });

  // A disc-dominant star never takes the dim, so its radius must not move
  // either — the local depth pass orders the pair geometrically.
  it('leaves a disc-dominant star its full radius at totality', () => {
    const resolved = components({ appMag: -10, appSizePx: 12, physSizePx: 40, physSizePxUncapped: 40 });
    expect(resolveStarPickVisibility(args({ components: resolved, eclipseDim: 0 })).hitRadius)
      .toBe(resolveStarPickVisibility(args({ components: resolved })).hitRadius);
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
