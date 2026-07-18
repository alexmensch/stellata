import { describe, expect, it, vi } from 'vitest';
import { PoiStore, POI_MAX_COUNT } from './poi-store';
import type { Target } from '../camera/focus/focus-target';

const SOL = 0;
const NO_SID = 5;
const ATTACHED_PLANETS = 9;

const star = (idx: number): Target => ({ kind: 'star', idx });
const planet = (idx: number): Target => ({ kind: 'planet', idx });

function makeStore() {
  const sid = new Uint32Array(40).fill(1);
  sid[NO_SID] = 0;
  const onChange = vi.fn();
  const store = new PoiStore({
    count: 40,
    sid,
    planetPinnable: (idx) => idx >= 0 && idx < ATTACHED_PLANETS,
    onChange,
  });
  return { store, onChange };
}

describe('PoiStore', () => {
  it('pins and unpins via toggle, firing onChange each time', () => {
    const { store, onChange } = makeStore();
    store.toggle(star(3));
    expect(store.get()).toEqual([star(3)]);
    expect(store.has(star(3))).toBe(true);
    store.toggle(star(3));
    expect(store.get()).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('pins planets through the same toggle path as stars', () => {
    const { store, onChange } = makeStore();
    store.toggle(planet(2));
    expect(store.get()).toEqual([planet(2)]);
    expect(store.has(planet(2))).toBe(true);
    // Same idx, different kind — distinct pins.
    store.toggle(star(2));
    expect(store.get()).toEqual([planet(2), star(2)]);
    store.toggle(planet(2));
    expect(store.get()).toEqual([star(2)]);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('rejects missing-SID, out-of-range, and unattached planets without firing onChange', () => {
    const { store, onChange } = makeStore();
    store.toggle(star(NO_SID));
    store.toggle(star(-1));
    store.toggle(star(40));
    store.toggle(planet(ATTACHED_PLANETS));
    store.toggle({ kind: 'lg', idx: 0 });
    expect(store.get()).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('pins Sol like any other star — no per-object carve-out in the ladder', () => {
    // Regression: Sol was once excluded ("the HUD #sol-arrow already
    // covers it"), which made a navigate click on Sol skip the pin rung
    // and draw the distance vector immediately — read by users as the
    // pin→vector→clear ladder being broken.
    const { store, onChange } = makeStore();
    expect(store.pinnable(star(SOL))).toBe(true);
    store.toggle(star(SOL));
    expect(store.has(star(SOL))).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('caps additions at POI_MAX_COUNT', () => {
    const { store } = makeStore();
    for (let i = 1; i <= POI_MAX_COUNT + 3; i++) store.toggle(star(i === NO_SID ? 20 + i : i));
    expect(store.get()).toHaveLength(POI_MAX_COUNT);
    // Unpinning below the cap lets a new pin in.
    store.toggle(store.get()[0]);
    store.toggle(star(39));
    expect(store.has(star(39))).toBe(true);
  });

  it('preserves insertion order across kinds', () => {
    const { store } = makeStore();
    store.toggle(star(7));
    store.toggle(planet(2));
    store.toggle(star(30));
    expect(store.get()).toEqual([star(7), planet(2), star(30)]);
  });

  it('pinnable mirrors the toggle gates', () => {
    const { store } = makeStore();
    expect(store.pinnable(star(3))).toBe(true);
    expect(store.pinnable(star(SOL))).toBe(true);
    expect(store.pinnable(star(NO_SID))).toBe(false);
    expect(store.pinnable(star(-1))).toBe(false);
    expect(store.pinnable(star(40))).toBe(false);
    expect(store.pinnable(planet(0))).toBe(true);
    expect(store.pinnable(planet(ATTACHED_PLANETS))).toBe(false);
    expect(store.pinnable({ kind: 'cloud', idx: 0 })).toBe(false);
    expect(store.pinnable({ kind: 'lg', idx: 0 })).toBe(false);
  });

  it('set validates, dedupes, caps, and skips the no-change write', () => {
    const { store, onChange } = makeStore();
    store.set([star(3), star(SOL), star(NO_SID), star(3), planet(1), star(-1), star(40)]);
    expect(store.get()).toEqual([star(3), star(SOL), planet(1)]);
    expect(onChange).toHaveBeenCalledTimes(1);
    store.set([star(3), star(SOL), planet(1)]);
    expect(onChange).toHaveBeenCalledTimes(1);
    store.set(Array.from({ length: 30 }, (_, i) => star(7 + i)));
    expect(store.get()).toHaveLength(POI_MAX_COUNT);
  });

  it('clear empties the list once and is a no-op when already empty', () => {
    const { store, onChange } = makeStore();
    store.clear();
    expect(onChange).not.toHaveBeenCalled();
    store.toggle(star(3));
    store.clear();
    expect(store.get()).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
