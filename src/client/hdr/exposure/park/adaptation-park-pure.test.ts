import { describe, expect, it } from 'vitest';
import {
  ADAPT_PARK_PROBE_INTERVAL_FRAMES,
  ADAPT_PARK_SETTLED_LANDINGS,
  INITIAL_PARK_STATE,
  type ParkLanding,
  type ParkState,
  parkTick,
  parkUnderHold,
} from './adaptation-park-pure';
import { ADAPT_DISPLAY_FLOOR_DM, ADAPT_SLEW_SETTLE_MAG } from '../scene-adaptation-pure';

function landing(over: Partial<ParkLanding> = {}): ParkLanding {
  return {
    fresh: true,
    measuredDm: 0,
    appliedDm: 0,
    regime: 'open',
    probeReady: true,
    ...over,
  };
}

function landZeros(state: ParkState, n: number): ParkState {
  for (let i = 0; i < n; i++) state = parkTick(state, landing());
  return state;
}

function idleFrames(state: ParkState, n: number, probeReady = true): ParkState {
  for (let i = 0; i < n; i++) state = parkTick(state, landing({ fresh: false, probeReady }));
  return state;
}

/** The floor regime as the readout reports it at the app default view: the
 *  cut sits at the display floor, the applied cut has settled there, and the
 *  pin's weight is zero. */
const FLOOR_LANDING: ParkLanding = landing({
  measuredDm: ADAPT_DISPLAY_FLOOR_DM,
  appliedDm: ADAPT_DISPLAY_FLOOR_DM,
  regime: 'floor',
});

describe('parkTick — engaging', () => {
  it('parks after exactly the required consecutive zero landings', () => {
    const oneShort = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_SETTLED_LANDINGS - 1);
    expect(oneShort.phase).toBe('active');
    expect(parkTick(oneShort, landing()).phase).toBe('parked');
  });

  it('resets the streak on a landing that measured a cut', () => {
    const streak = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_SETTLED_LANDINGS - 1);
    const reset = parkTick(streak, landing({ measuredDm: -0.5, appliedDm: -0.5, regime: 'eye' }));
    expect(reset).toEqual(INITIAL_PARK_STATE);
  });

  it('resets the streak while the applied cut is still slewing back to zero', () => {
    const streak = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_SETTLED_LANDINGS - 1);
    expect(parkTick(streak, landing({ appliedDm: -0.01 }))).toEqual(INITIAL_PARK_STATE);
  });

  it('parks on a cut the slew itself treats as settled', () => {
    const inBand = -0.5 * ADAPT_SLEW_SETTLE_MAG;
    const oneShort = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_SETTLED_LANDINGS - 1);
    expect(parkTick(oneShort, landing({ measuredDm: inBand, appliedDm: inBand })).phase)
      .toBe('parked');
  });

  it('resets on a cut just past the settle band', () => {
    const pastBand = -2 * ADAPT_SLEW_SETTLE_MAG;
    const oneShort = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_SETTLED_LANDINGS - 1);
    expect(parkTick(oneShort, landing({
      measuredDm: pastBand, appliedDm: pastBand, regime: 'eye',
    }))).toEqual(INITIAL_PARK_STATE);
  });

  it('does not advance the streak on frames without a fresh landing', () => {
    const streak = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_SETTLED_LANDINGS - 1);
    expect(idleFrames(streak, 50)).toEqual(streak);
  });
});

describe('parkTick — the floor regime', () => {
  it('parks a deep cut the display floor is holding constant', () => {
    let state = INITIAL_PARK_STATE;
    for (let i = 0; i < ADAPT_PARK_SETTLED_LANDINGS; i++) {
      state = parkTick(state, FLOOR_LANDING);
    }
    expect(state.phase).toBe('parked');
  });

  it('refuses to park a cut the eye branch is setting, however settled', () => {
    let state = INITIAL_PARK_STATE;
    const eye = landing({ measuredDm: -3, appliedDm: -3, regime: 'eye' });
    for (let i = 0; i < 10; i++) state = parkTick(state, eye);
    expect(state).toEqual(INITIAL_PARK_STATE);
  });

  it('refuses to park while the applied cut is still slewing down to the floor', () => {
    const streak = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_SETTLED_LANDINGS - 1);
    expect(parkTick(streak, landing({
      measuredDm: ADAPT_DISPLAY_FLOOR_DM, appliedDm: -1, regime: 'floor',
    }))).toEqual(INITIAL_PARK_STATE);
  });

  it('stays parked while probe landings keep measuring the floor', () => {
    let state = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_SETTLED_LANDINGS);
    for (let i = 0; i < 4; i++) {
      state = idleFrames(state, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
      expect(state.phase).toBe('probing');
      state = parkTick(state, FLOOR_LANDING);
      expect(state).toEqual({ phase: 'parked', framesSinceProbe: 0 });
    }
  });

  it('unparks when the frame mean falls under the white point and the eye takes over', () => {
    const parked = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_SETTLED_LANDINGS);
    const probing = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    const eyeTakesOver = landing({
      measuredDm: ADAPT_DISPLAY_FLOOR_DM / 2,
      appliedDm: ADAPT_DISPLAY_FLOOR_DM,
      regime: 'eye',
    });
    expect(parkTick(probing, eyeTakesOver)).toEqual(INITIAL_PARK_STATE);
  });

  it('unparks when coverage rises off zero and the pin starts to weigh', () => {
    const parked = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_SETTLED_LANDINGS);
    const probing = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    const handover = landing({
      measuredDm: ADAPT_DISPLAY_FLOOR_DM - 2,
      appliedDm: ADAPT_DISPLAY_FLOOR_DM,
      regime: 'handover',
    });
    expect(parkTick(probing, handover)).toEqual(INITIAL_PARK_STATE);
  });
});

describe('parkTick — the duty cycle', () => {
  const parked = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_SETTLED_LANDINGS);

  it('probes after exactly the interval of rendered frames', () => {
    const oneShort = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES - 1);
    expect(oneShort.phase).toBe('parked');
    expect(parkTick(oneShort, landing({ fresh: false })).phase).toBe('probing');
  });

  it('stays parked past the interval while the reduction cannot draw', () => {
    const waiting = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES + 20, false);
    expect(waiting.phase).toBe('parked');
    expect(parkTick(waiting, landing({ fresh: false })).phase).toBe('probing');
  });

  it('holds the probe open across frames whose readback has not landed', () => {
    const probing = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    expect(idleFrames(probing, 50, false).phase).toBe('probing');
  });

  it('re-parks on a zero probe landing, restarting the interval', () => {
    const probing = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    expect(parkTick(probing, landing())).toEqual({ phase: 'parked', framesSinceProbe: 0 });
  });

  it('unparks immediately on a probe landing that measured a cut', () => {
    const probing = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    expect(parkTick(probing, landing({
      measuredDm: -2 * ADAPT_SLEW_SETTLE_MAG, regime: 'eye',
    }))).toEqual(INITIAL_PARK_STATE);
  });

  it('unparks on a leftover live landing that arrives while parked', () => {
    expect(parkTick(parked, landing({ measuredDm: -0.5, regime: 'eye' })))
      .toEqual(INITIAL_PARK_STATE);
  });
});

describe('parkUnderHold', () => {
  const parked = landZeros(INITIAL_PARK_STATE, ADAPT_PARK_SETTLED_LANDINGS);

  it('collapses a probe in flight to parked', () => {
    const probing = idleFrames(parked, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    expect(parkUnderHold(probing)).toEqual({ phase: 'parked', framesSinceProbe: 0 });
  });

  it('leaves every other phase where it stands', () => {
    expect(parkUnderHold(INITIAL_PARK_STATE)).toEqual(INITIAL_PARK_STATE);
    expect(parkUnderHold(parked)).toEqual(parked);
  });
});
