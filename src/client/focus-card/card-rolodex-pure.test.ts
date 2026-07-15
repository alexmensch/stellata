import { describe, it, expect } from 'vitest';
import {
  FOCUS_KEY,
  planRolodex,
  poiIdxOf,
  poiKey,
  STRIP_HEIGHT_MAX_PX,
  STRIP_HEIGHT_MIN_PX,
  stripHeightPx,
} from './card-rolodex-pure';

describe('focus-card/planRolodex', () => {
  it('puts the focus card in front by default, pins as newest-first strips', () => {
    const plan = planRolodex({
      pois: [3, 7, 11],
      focusedStar: 42,
      focusVisible: true,
      desiredFront: null,
    });
    expect(plan.front).toBe(FOCUS_KEY);
    expect(plan.strips).toEqual([poiKey(11), poiKey(7), poiKey(3)]);
    expect(plan.minimizedFront).toBe(FOCUS_KEY);
  });

  it('fronts the newest pin when no focus card is visible', () => {
    const plan = planRolodex({
      pois: [3, 7, 11],
      focusedStar: null,
      focusVisible: false,
      desiredFront: null,
    });
    expect(plan.front).toBe(poiKey(11));
    expect(plan.strips).toEqual([poiKey(7), poiKey(3)]);
    expect(plan.minimizedFront).toBe(poiKey(11));
  });

  it('honours a promoted card, keeping the focus strip on top', () => {
    const plan = planRolodex({
      pois: [3, 7, 11],
      focusedStar: 42,
      focusVisible: true,
      desiredFront: poiKey(7),
    });
    expect(plan.front).toBe(poiKey(7));
    expect(plan.strips).toEqual([FOCUS_KEY, poiKey(11), poiKey(3)]);
  });

  it('minimizes to the focused object even when a pin is promoted to front', () => {
    const plan = planRolodex({
      pois: [3, 7, 11],
      focusedStar: 42,
      focusVisible: true,
      desiredFront: poiKey(7),
    });
    expect(plan.minimizedFront).toBe(FOCUS_KEY);
  });

  it('falls back to the default front when the desired card is gone', () => {
    const plan = planRolodex({
      pois: [3, 11],
      focusedStar: 42,
      focusVisible: true,
      desiredFront: poiKey(7),
    });
    expect(plan.front).toBe(FOCUS_KEY);
  });

  it('falls back when the focus card is desired but not visible (observe mode)', () => {
    const plan = planRolodex({
      pois: [3, 7],
      focusedStar: 42,
      focusVisible: false,
      desiredFront: FOCUS_KEY,
    });
    expect(plan.front).toBe(poiKey(7));
    expect(plan.strips).toEqual([poiKey(3)]);
  });

  it('suppresses the focused star pin card in every mode', () => {
    const navigate = planRolodex({
      pois: [3, 7, 11],
      focusedStar: 7,
      focusVisible: true,
      desiredFront: null,
    });
    expect(navigate.strips).toEqual([poiKey(11), poiKey(3)]);
    const observe = planRolodex({
      pois: [3, 7, 11],
      focusedStar: 7,
      focusVisible: false,
      desiredFront: null,
    });
    expect(observe.front).toBe(poiKey(11));
    expect(observe.strips).toEqual([poiKey(3)]);
  });

  it('hides the stack when no card is available', () => {
    const plan = planRolodex({
      pois: [7],
      focusedStar: 7,
      focusVisible: false,
      desiredFront: null,
    });
    expect(plan.front).toBeNull();
    expect(plan.strips).toEqual([]);
  });

  it('round-trips pin keys', () => {
    expect(poiIdxOf(poiKey(313241))).toBe(313241);
    expect(poiIdxOf(FOCUS_KEY)).toBeNull();
  });
});

describe('focus-card/stripHeightPx', () => {
  it('keeps small stacks at full strip height', () => {
    expect(stripHeightPx(0)).toBe(STRIP_HEIGHT_MAX_PX);
    expect(stripHeightPx(1)).toBe(STRIP_HEIGHT_MAX_PX);
    expect(stripHeightPx(9)).toBe(STRIP_HEIGHT_MAX_PX);
  });

  it('compresses as the strip count grows', () => {
    expect(stripHeightPx(10)).toBe(24);
    expect(stripHeightPx(12)).toBe(20);
  });

  it('bottoms out at the legible floor at the 16-pin cap', () => {
    expect(stripHeightPx(16)).toBe(15);
    expect(stripHeightPx(16)).toBe(STRIP_HEIGHT_MIN_PX);
    expect(stripHeightPx(32)).toBe(STRIP_HEIGHT_MIN_PX);
  });
});
