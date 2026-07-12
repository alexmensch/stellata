import { describe, expect, it, vi } from 'vitest';
import { PoiStore, POI_MAX_COUNT } from './poi-store';

const SOL = 0;
const NO_SID = 5;

function makeStore() {
  const sid = new Uint32Array(40).fill(1);
  sid[NO_SID] = 0;
  const onChange = vi.fn();
  const store = new PoiStore({ count: 40, solIndex: SOL, sid, onChange });
  return { store, onChange };
}

describe('PoiStore', () => {
  it('pins and unpins via toggle, firing onChange each time', () => {
    const { store, onChange } = makeStore();
    store.toggle(3);
    expect(store.get()).toEqual([3]);
    expect(store.has(3)).toBe(true);
    store.toggle(3);
    expect(store.get()).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('rejects Sol, missing-SID, and out-of-range without firing onChange', () => {
    const { store, onChange } = makeStore();
    store.toggle(SOL);
    store.toggle(NO_SID);
    store.toggle(-1);
    store.toggle(40);
    expect(store.get()).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('caps additions at POI_MAX_COUNT', () => {
    const { store } = makeStore();
    for (let i = 1; i <= POI_MAX_COUNT + 3; i++) store.toggle(i === NO_SID ? 20 + i : i);
    expect(store.get()).toHaveLength(POI_MAX_COUNT);
    // Unpinning below the cap lets a new pin in.
    store.toggle(store.get()[0]);
    store.toggle(39);
    expect(store.has(39)).toBe(true);
  });

  it('preserves insertion order', () => {
    const { store } = makeStore();
    store.toggle(7);
    store.toggle(2);
    store.toggle(30);
    expect(store.get()).toEqual([7, 2, 30]);
  });

  it('pinnable mirrors the toggle gates', () => {
    const { store } = makeStore();
    expect(store.pinnable(3)).toBe(true);
    expect(store.pinnable(SOL)).toBe(false);
    expect(store.pinnable(NO_SID)).toBe(false);
    expect(store.pinnable(-1)).toBe(false);
    expect(store.pinnable(40)).toBe(false);
  });

  it('set validates, dedupes, caps, and skips the no-change write', () => {
    const { store, onChange } = makeStore();
    store.set([3, SOL, NO_SID, 3, 4, -1, 40]);
    expect(store.get()).toEqual([3, 4]);
    expect(onChange).toHaveBeenCalledTimes(1);
    store.set([3, 4]);
    expect(onChange).toHaveBeenCalledTimes(1);
    store.set(Array.from({ length: 30 }, (_, i) => 7 + i));
    expect(store.get()).toHaveLength(POI_MAX_COUNT);
  });

  it('clear empties the list once and is a no-op when already empty', () => {
    const { store, onChange } = makeStore();
    store.clear();
    expect(onChange).not.toHaveBeenCalled();
    store.toggle(3);
    store.clear();
    expect(store.get()).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
