import { describe, it, expect } from 'vitest';
import {
  FOCUS_KEY,
  planRolodex,
  poiTargetOf,
  poiKey,
  STRIP_HEIGHT_MAX_PX,
  STRIP_HEIGHT_MIN_PX,
  stripHeightPx,
} from './card-rolodex-pure';
import type { Target } from '../camera/focus/focus-target';

const star = (idx: number): Target => ({ kind: 'star', idx });

describe('focus-card/planRolodex', () => {
  it('puts the focus card in front by default, pins as newest-first strips', () => {
    const plan = planRolodex({
      pois: [star(3), star(7), star(11)],
      focused: star(42),
      focusVisible: true,
      desiredFront: null,
    });
    expect(plan.front).toBe(FOCUS_KEY);
    expect(plan.strips).toEqual([poiKey(star(11)), poiKey(star(7)), poiKey(star(3))]);
    expect(plan.minimizedFront).toBe(FOCUS_KEY);
  });

  it('fronts the newest pin when no focus card is visible', () => {
    const plan = planRolodex({
      pois: [star(3), star(7), star(11)],
      focused: null,
      focusVisible: false,
      desiredFront: null,
    });
    expect(plan.front).toBe(poiKey(star(11)));
    expect(plan.strips).toEqual([poiKey(star(7)), poiKey(star(3))]);
    expect(plan.minimizedFront).toBe(poiKey(star(11)));
  });

  it('honours a promoted card, keeping the focus strip on top', () => {
    const plan = planRolodex({
      pois: [star(3), star(7), star(11)],
      focused: star(42),
      focusVisible: true,
      desiredFront: poiKey(star(7)),
    });
    expect(plan.front).toBe(poiKey(star(7)));
    expect(plan.strips).toEqual([FOCUS_KEY, poiKey(star(11)), poiKey(star(3))]);
  });

  it('minimizes to the focused object even when a pin is promoted to front', () => {
    const plan = planRolodex({
      pois: [star(3), star(7), star(11)],
      focused: star(42),
      focusVisible: true,
      desiredFront: poiKey(star(7)),
    });
    expect(plan.minimizedFront).toBe(FOCUS_KEY);
  });

  it('falls back to the default front when the desired card is gone', () => {
    const plan = planRolodex({
      pois: [star(3), star(11)],
      focused: star(42),
      focusVisible: true,
      desiredFront: poiKey(star(7)),
    });
    expect(plan.front).toBe(FOCUS_KEY);
  });

  it('falls back when the focus card is desired but not visible (observe mode)', () => {
    const plan = planRolodex({
      pois: [star(3), star(7)],
      focused: star(42),
      focusVisible: false,
      desiredFront: FOCUS_KEY,
    });
    expect(plan.front).toBe(poiKey(star(7)));
    expect(plan.strips).toEqual([poiKey(star(3))]);
  });

  it("suppresses the focused object's pin card in every mode", () => {
    const navigate = planRolodex({
      pois: [star(3), star(7), star(11)],
      focused: star(7),
      focusVisible: true,
      desiredFront: null,
    });
    expect(navigate.strips).toEqual([poiKey(star(11)), poiKey(star(3))]);
    const observe = planRolodex({
      pois: [star(3), star(7), star(11)],
      focused: star(7),
      focusVisible: false,
      desiredFront: null,
    });
    expect(observe.front).toBe(poiKey(star(11)));
    expect(observe.strips).toEqual([poiKey(star(3))]);
  });

  it('hides the stack when no card is available', () => {
    const plan = planRolodex({
      pois: [star(7)],
      focused: star(7),
      focusVisible: false,
      desiredFront: null,
    });
    expect(plan.front).toBeNull();
    expect(plan.strips).toEqual([]);
  });

  it('round-trips pin keys across kinds', () => {
    expect(poiTargetOf(poiKey(star(313241)))).toEqual(star(313241));
    expect(poiTargetOf(poiKey({ kind: 'planet', idx: 4 }))).toEqual({ kind: 'planet', idx: 4 });
    expect(poiTargetOf(FOCUS_KEY)).toBeNull();
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
