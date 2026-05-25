import { describe, it, expect } from 'vitest';
import {
  ON_SCREEN_PULL_IN_PX,
  emptyEntryDirtyState,
  isPoiOnScreen,
  resetEntrySentinels,
  type EntryDirtyState,
} from './poi-overlay';

describe('poi-overlay / emptyEntryDirtyState', () => {
  it('returns every sentinel at its poison-init value', () => {
    // First-init contract: each entry's per-attribute sentinel must fail
    // its dirty-attr gate's matching test so the first visible frame's
    // writes all land. Numeric sentinels poison via NaN (any real value
    // differs); string + path-data sentinels poison via '\0' so an empty
    // string still writes through.
    const s = emptyEntryDirtyState();
    expect(s.lastArrowD).toBe('\0');
    expect(s.lastArrowLabelDisplay).toBe('\0');
    expect(s.lastArrowLabelText).toBe('\0');
    expect(Number.isNaN(s.lastArrowLabelX)).toBe(true);
    expect(Number.isNaN(s.lastArrowLabelY)).toBe(true);
    expect(s.lastRingDisplay).toBe('\0');
    expect(Number.isNaN(s.lastRingCx)).toBe(true);
    expect(Number.isNaN(s.lastRingCy)).toBe(true);
    expect(s.lastOnScreenLabelDisplay).toBe('\0');
    expect(s.lastOnScreenLabelText).toBe('\0');
    expect(Number.isNaN(s.lastOnScreenLabelX)).toBe(true);
    expect(Number.isNaN(s.lastOnScreenLabelY)).toBe(true);
  });
});

describe('poi-overlay / isPoiOnScreen', () => {
  const W = 1280;
  const H = 800;

  it('returns false for a null projection (behind the camera)', () => {
    expect(isPoiOnScreen(null, W, H)).toBe(false);
  });

  it('returns true for a centred projection', () => {
    expect(isPoiOnScreen([W / 2, H / 2], W, H)).toBe(true);
  });

  it('returns true at the inner edge of the pull-in margin', () => {
    // Exactly on the margin boundary counts as on-screen — the `>=` /
    // `<=` choice prevents jitter when a star sits right at the threshold.
    expect(isPoiOnScreen([ON_SCREEN_PULL_IN_PX, ON_SCREEN_PULL_IN_PX], W, H)).toBe(true);
    expect(isPoiOnScreen([W - ON_SCREEN_PULL_IN_PX, H - ON_SCREEN_PULL_IN_PX], W, H)).toBe(true);
  });

  it('returns false just outside the pull-in margin', () => {
    expect(isPoiOnScreen([ON_SCREEN_PULL_IN_PX - 0.5, H / 2], W, H)).toBe(false);
    expect(isPoiOnScreen([W / 2, ON_SCREEN_PULL_IN_PX - 0.5], W, H)).toBe(false);
    expect(isPoiOnScreen([W - ON_SCREEN_PULL_IN_PX + 0.5, H / 2], W, H)).toBe(false);
    expect(isPoiOnScreen([W / 2, H - ON_SCREEN_PULL_IN_PX + 0.5], W, H)).toBe(false);
  });

  it('returns false for off-screen projections', () => {
    expect(isPoiOnScreen([-10, H / 2], W, H)).toBe(false);
    expect(isPoiOnScreen([W / 2, -10], W, H)).toBe(false);
    expect(isPoiOnScreen([W + 100, H / 2], W, H)).toBe(false);
    expect(isPoiOnScreen([W / 2, H + 100], W, H)).toBe(false);
  });
});

describe('poi-overlay / resetEntrySentinels', () => {
  it('wipes the post-hide subset back to poison', () => {
    // hideEntry's contract: gate the visible d / display writes through
    // the dirty-attr helpers (so the cached value reflects the hide
    // state), then call resetEntrySentinels to poison the remaining
    // sentinels. Without this reset, a re-show whose new label coords
    // fell within ATTR_DIRTY_PX of the prior session's values would
    // silently skip the first-frame setAttribute and inherit the stale
    // x/y. Same shape as hud-overlay's resetArrowSentinels.
    const populated: EntryDirtyState = {
      lastArrowD: 'M100,200L150,250',
      lastArrowLabelDisplay: 'none',
      lastArrowLabelText: 'Vega',
      lastArrowLabelX: 312,
      lastArrowLabelY: 96,
      lastRingDisplay: '',
      lastRingCx: 480,
      lastRingCy: 200,
      lastOnScreenLabelDisplay: '',
      lastOnScreenLabelText: 'Vega · Lyr · 7.7 pc',
      lastOnScreenLabelX: 504,
      lastOnScreenLabelY: 224,
    };
    resetEntrySentinels(populated);
    // Numeric sentinels return to NaN.
    expect(Number.isNaN(populated.lastArrowLabelX)).toBe(true);
    expect(Number.isNaN(populated.lastArrowLabelY)).toBe(true);
    expect(Number.isNaN(populated.lastRingCx)).toBe(true);
    expect(Number.isNaN(populated.lastRingCy)).toBe(true);
    expect(Number.isNaN(populated.lastOnScreenLabelX)).toBe(true);
    expect(Number.isNaN(populated.lastOnScreenLabelY)).toBe(true);
    // Text sentinels return to '\0'.
    expect(populated.lastArrowLabelText).toBe('\0');
    expect(populated.lastOnScreenLabelText).toBe('\0');
    // Visible d / display sentinels are NOT wiped — they ride the dirty-
    // attr gate so the hide-state cached value stays intact.
    expect(populated.lastArrowD).toBe('M100,200L150,250');
    expect(populated.lastArrowLabelDisplay).toBe('none');
    expect(populated.lastRingDisplay).toBe('');
    expect(populated.lastOnScreenLabelDisplay).toBe('');
  });
});
