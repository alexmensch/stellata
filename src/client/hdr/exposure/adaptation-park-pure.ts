// The adaptation measurement's park: the per-rendered-frame state machine
// deciding when the reduction draws and the statistic writes may stop.
// See README.md § Parking the measurement.

import { ADAPT_SLEW_SETTLE_MAG } from './scene-adaptation-pure';

/** Consecutive landed measurements reading no cut, with the applied cut
 *  settled there, before the measurement parks. */
export const ADAPT_PARK_ZERO_LANDINGS = 3;

/** Rendered frames between wake probes while parked. Detection of a scene
 *  turning bright is bounded by this many rendered frames, the wait for a
 *  frame the chain can draw on, and the slew. */
export const ADAPT_PARK_PROBE_INTERVAL_FRAMES = 6;

/** Each phase carries its own counter and no other: a streak of zero
 *  landings while active, the probe interval while parked, nothing while a
 *  probe is in flight. */
export type ParkState =
  | { readonly phase: 'active'; readonly zeroLandings: number }
  | { readonly phase: 'parked'; readonly framesSinceProbe: number }
  | { readonly phase: 'probing' };

export type ParkPhase = ParkState['phase'];

export const INITIAL_PARK_STATE: ParkState = { phase: 'active', zeroLandings: 0 };

const PARKED_STATE: ParkState = { phase: 'parked', framesSinceProbe: 0 };

const PROBING_STATE: ParkState = { phase: 'probing' };

/** No cut, to the exposure subsystem's own resolution — `ADAPT_SLEW_SETTLE_MAG`
 *  borrowed rather than re-picked, exactly as `exposureCutMoved` borrows it
 *  (`../../render-gate/README.md`). An exact test would never park at a
 *  vantage whose cut lands inside the settle band, because `slewDm` hands
 *  that cut back verbatim as the applied one — leaving the measurement
 *  running at full cost for a cut the render gate will not repaint for. */
function noCut(dm: number): boolean {
  return Math.abs(dm) <= ADAPT_SLEW_SETTLE_MAG;
}

/**
 * One rendered frame of the park machine. `landedFresh` is a LIVE landing —
 * a reduction of a frame whose statistic writes were open; the stale
 * readbacks the parked fence keeps issuing never surface as one.
 * `probeReady` is the reduction having no readback in flight, so a probe
 * opened this frame draws on this frame.
 *
 * A fresh landing outranks everything: any evidence of a cut returns to
 * active immediately, wherever it arrives — including a request still in
 * flight when the park engaged.
 */
export function parkTick(
  state: ParkState,
  landedFresh: boolean,
  measuredDm: number,
  appliedDm: number,
  probeReady: boolean,
): ParkState {
  if (landedFresh) {
    if (!noCut(measuredDm) || !noCut(appliedDm)) return INITIAL_PARK_STATE;
    if (state.phase === 'active') {
      const zeroLandings = state.zeroLandings + 1;
      if (zeroLandings < ADAPT_PARK_ZERO_LANDINGS) return { phase: 'active', zeroLandings };
    }
    return PARKED_STATE;
  }
  if (state.phase === 'parked') {
    const framesSinceProbe = state.framesSinceProbe + 1;
    // Past the interval the machine waits for a drawable frame rather than
    // opening the writes on one the chain will sit out: the writes would be
    // paid with nothing reducing what they wrote.
    if (framesSinceProbe >= ADAPT_PARK_PROBE_INTERVAL_FRAMES && probeReady) return PROBING_STATE;
    return { phase: 'parked', framesSinceProbe };
  }
  return state;
}

/** A hold freezes the machine, and collapses a probe in flight back to
 *  parked so every dwell of a frame-cost sweep prices the same state. */
export function parkUnderHold(state: ParkState): ParkState {
  return state.phase === 'probing' ? PARKED_STATE : state;
}
