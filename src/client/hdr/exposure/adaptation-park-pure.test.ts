import { describe, expect, it } from 'vitest';
import {
  ADAPT_PARK_PROBE_INTERVAL_FRAMES,
  ADAPT_PARK_ZERO_LANDINGS,
  INITIAL_PARK_STATE,
  type ParkState,
  parkTick,
} from './adaptation-park-pure';

function landZeros(state: ParkState, n: number): ParkState {
  for (let i = 0; i < n; i++) state = parkTick(state, true, 0, 0);
  return state;
}

function idleFrames(state: ParkState, n: number): ParkState {
  for (let i = 0; i < n; i++) state = parkTick(state, false, 0, 0);
  return state;
}

describe('parkTick — engaging', () => {
  it('parks after exactly the required consecutive zero landings', () => {
    const oneShort = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_ZERO_LANDINGS - 1);
    expect(oneShort.phase).toBe('active');
    expect(parkTick(oneShort, true, 0, 0).phase).toBe('parked');
  });

  it('resets the streak on a landing that measured a cut', () => {
    const streak = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_ZERO_LANDINGS - 1);
    const reset = parkTick(streak, true, -0.5, -0.5);
    expect(reset).toEqual(INITIAL_PARK_STATE);
  });

  it('resets the streak while the applied cut is still slewing back to zero', () => {
    const streak = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_ZERO_LANDINGS - 1);
    expect(parkTick(streak, true, 0, -0.01)).toEqual(INITIAL_PARK_STATE);
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
    expect(parkTick(oneShort, false, 0, 0).phase).toBe('probing');
  });

  it('holds the probe open across frames whose readback has not landed', () => {
    const probing = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    expect(idleFrames(probing, 50).phase).toBe('probing');
  });

  it('re-parks on a zero probe landing, restarting the interval', () => {
    const probing = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    const reParked = parkTick(probing, true, 0, 0);
    expect(reParked).toEqual(parked);
    expect(reParked.framesSinceProbe).toBe(0);
  });

  it('unparks immediately on a probe landing that measured any cut', () => {
    const probing = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    expect(parkTick(probing, true, -1e-6, 0)).toEqual(INITIAL_PARK_STATE);
  });

  it('unparks on a leftover live landing that arrives while parked', () => {
    expect(parkTick(parked, true, -0.5, 0)).toEqual(INITIAL_PARK_STATE);
  });
});
