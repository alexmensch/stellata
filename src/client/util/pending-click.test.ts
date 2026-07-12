import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingClickDispatcher } from './pending-click';

const DBL_MS = 280;
const DIST_SQ = 8 * 8;

describe('PendingClickDispatcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function make() {
    const single = vi.fn();
    const dbl = vi.fn();
    const d = new PendingClickDispatcher(DBL_MS, DIST_SQ, single, dbl);
    return { d, single, dbl };
  }

  it('fires a single click only after the double-click window elapses', () => {
    const { d, single, dbl } = make();
    d.click(100, 100);
    expect(single).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DBL_MS - 1);
    expect(single).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(single).toHaveBeenCalledWith(100, 100);
    expect(dbl).not.toHaveBeenCalled();
  });

  it('two nearby clicks inside the window fire one double, no singles', () => {
    const { d, single, dbl } = make();
    d.click(100, 100);
    vi.advanceTimersByTime(100);
    d.click(104, 103);
    expect(dbl).toHaveBeenCalledWith(104, 103);
    vi.runAllTimers();
    expect(single).not.toHaveBeenCalled();
    expect(dbl).toHaveBeenCalledTimes(1);
  });

  it('a far-apart second click fires the held single immediately and re-arms', () => {
    const { d, single, dbl } = make();
    d.click(100, 100);
    vi.advanceTimersByTime(100);
    d.click(400, 400);
    expect(single).toHaveBeenCalledWith(100, 100);
    expect(dbl).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DBL_MS);
    expect(single).toHaveBeenCalledWith(400, 400);
    expect(single).toHaveBeenCalledTimes(2);
  });

  it('a third click after a double starts a fresh cycle', () => {
    const { d, single, dbl } = make();
    d.click(10, 10);
    d.click(10, 10);
    expect(dbl).toHaveBeenCalledTimes(1);
    d.click(10, 10);
    vi.advanceTimersByTime(DBL_MS);
    expect(single).toHaveBeenCalledTimes(1);
  });

  it('cancel drops the held click without firing', () => {
    const { d, single, dbl } = make();
    d.click(100, 100);
    d.cancel();
    vi.runAllTimers();
    expect(single).not.toHaveBeenCalled();
    expect(dbl).not.toHaveBeenCalled();
  });
});
