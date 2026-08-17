import { describe, expect, it } from 'vitest';
import {
  ADAPT_PARK_PROBE_INTERVAL_FRAMES,
  ADAPT_PARK_ZERO_LANDINGS,
  INITIAL_PARK_STATE,
  type ParkState,
  parkTick,
  parkUnderHold,
} from './adaptation-park-pure';
import { ADAPT_SLEW_SETTLE_MAG } from './scene-adaptation-pure';

function landZeros(state: ParkState, n: number): ParkState {
  for (let i = 0; i < n; i++) state = parkTick(state, true, 0, 0, true);
  return state;
}

function idleFrames(state: ParkState, n: number, probeReady = true): ParkState {
  for (let i = 0; i < n; i++) state = parkTick(state, false, 0, 0, probeReady);
  return state;
}

describe('parkTick — engaging', () => {
  it('parks after exactly the required consecutive zero landings', () => {
    const oneShort = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_ZERO_LANDINGS - 1);
    expect(oneShort.phase).toBe('active');
    expect(parkTick(oneShort, true, 0, 0, true).phase).toBe('parked');
  });

  it('resets the streak on a landing that measured a cut', () => {
    const streak = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_ZERO_LANDINGS - 1);
    const reset = parkTick(streak, true, -0.5, -0.5, true);
    expect(reset).toEqual(INITIAL_PARK_STATE);
  });

  it('resets the streak while the applied cut is still slewing back to zero', () => {
    const streak = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_ZERO_LANDINGS - 1);
    expect(parkTick(streak, true, 0, -0.01, true)).toEqual(INITIAL_PARK_STATE);
  });

  it('parks on a cut the slew itself treats as settled', () => {
    const inBand = -0.5 * ADAPT_SLEW_SETTLE_MAG;
    const oneShort = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_ZERO_LANDINGS - 1);
    expect(parkTick(oneShort, true, inBand, inBand, true).phase).toBe('parked');
  });

  it('resets on a cut just past the settle band', () => {
    const pastBand = -2 * ADAPT_SLEW_SETTLE_MAG;
    const oneShort = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_ZERO_LANDINGS - 1);
    expect(parkTick(oneShort, true, pastBand, pastBand, true)).toEqual(INITIAL_PARK_STATE);
  });

  it('does not advance the streak on frames without a fresh landing', () => {
    const streak = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_ZERO_LANDINGS - 1);
    expect(idleFrames(streak, 50)).toEqual(streak);
  });
});

describe('parkTick — the duty cycle', () => {
  const parked = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_ZERO_LANDINGS);

  it('probes after exactly the interval of rendered frames', () => {
    const oneShort = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES - 1);
    expect(oneShort.phase).toBe('parked');
    expect(parkTick(oneShort, false, 0, 0, true).phase).toBe('probing');
  });

  it('stays parked past the interval while the reduction cannot draw', () => {
    const waiting = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES + 20, false);
    expect(waiting.phase).toBe('parked');
    expect(parkTick(waiting, false, 0, 0, true).phase).toBe('probing');
  });

  it('holds the probe open across frames whose readback has not landed', () => {
    const probing = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    expect(idleFrames(probing, 50, false).phase).toBe('probing');
  });

  it('re-parks on a zero probe landing, restarting the interval', () => {
    const probing = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    expect(parkTick(probing, true, 0, 0, true)).toEqual({ phase: 'parked', framesSinceProbe: 0 });
  });

  it('unparks immediately on a probe landing that measured a cut', () => {
    const probing = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    expect(parkTick(probing, true, -2 * ADAPT_SLEW_SETTLE_MAG, 0, true))
      .toEqual(INITIAL_PARK_STATE);
  });

  it('unparks on a leftover live landing that arrives while parked', () => {
    expect(parkTick(parked, true, -0.5, 0, true)).toEqual(INITIAL_PARK_STATE);
  });
});

describe('parkUnderHold', () => {
  const parked = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_ZERO_LANDINGS);

  it('collapses a probe in flight to parked', () => {
    const probing = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    expect(parkUnderHold(probing)).toEqual({ phase: 'parked', framesSinceProbe: 0 });
  });

  it('leaves every other phase where it stands', () => {
    expect(parkUnderHold(INITIAL_PARK_STATE)).toEqual(INITIAL_PARK_STATE);
    expect(parkUnderHold(parked)).toEqual(parked);
  });
});
