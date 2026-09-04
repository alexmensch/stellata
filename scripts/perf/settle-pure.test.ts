import { describe, expect, it } from 'vitest';
import { SETTLE_MS } from '../../src/client/render-gate/render-gate-pure';
import { DEFAULT_QUIET_MS, settleVerdict, type GateSnapshot } from './settle-pure';

const quiet: GateSnapshot = {
  now: 100_000,
  holds: 0,
  lastActiveMs: 100_000 - DEFAULT_QUIET_MS,
  lastWakeReason: 'dust-chunk',
  transition: false,
};

describe('settleVerdict', () => {
  it('is stuck on holds before anything else', () => {
    const v = settleVerdict({ ...quiet, holds: 2, transition: true, lastActiveMs: quiet.now });
    expect(v).toEqual({ settled: false, stuckOn: 'holds', detail: '2 render-gate hold(s) live' });
  });

  it('is stuck on a camera transition', () => {
    const v = settleVerdict({ ...quiet, transition: true });
    expect(v).toEqual({ settled: false, stuckOn: 'transition', detail: 'camera transition in flight' });
  });

  it('is stuck on activity inside the quiet window and names the last wake', () => {
    const v = settleVerdict({ ...quiet, lastActiveMs: quiet.now - 1200 });
    expect(v).toEqual({
      settled: false,
      stuckOn: 'active',
      detail: `last wake 1200 ms ago (dust-chunk); need ${DEFAULT_QUIET_MS} ms idle`,
    });
  });

  it('settles once idle for the quiet window', () => {
    expect(settleVerdict(quiet)).toEqual({ settled: true });
  });

  it('never accepts less idle than the render gate\'s own settle tail', () => {
    const v = settleVerdict({ ...quiet, lastActiveMs: quiet.now - SETTLE_MS + 1 }, 1);
    expect(v.settled).toBe(false);
    expect(settleVerdict({ ...quiet, lastActiveMs: quiet.now - SETTLE_MS }, 1)).toEqual({ settled: true });
  });

  it('treats a gate that never woke as settled', () => {
    expect(settleVerdict({ ...quiet, lastActiveMs: Number.NEGATIVE_INFINITY, lastWakeReason: null })).toEqual({
      settled: true,
    });
  });
});
