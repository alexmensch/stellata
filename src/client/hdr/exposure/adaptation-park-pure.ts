// The adaptation measurement's park: the per-rendered-frame state machine
// deciding when the reduction draws and the statistic writes may stop.
// See README.md § Parking the measurement.

/** Consecutive landed measurements reading exactly zero cut, with the
 *  applied cut settled at zero, before the measurement parks. */
export const ADAPT_PARK_ZERO_LANDINGS = 3;

/** Rendered frames between wake probes while parked. Detection of a scene
 *  turning bright is bounded by this many rendered frames plus the slew. */
export const ADAPT_PARK_PROBE_INTERVAL_FRAMES = 6;

export type ParkPhase = 'active' | 'parked' | 'probing';

export interface ParkState {
  phase: ParkPhase;
  /** Consecutive zero landings observed while active. */
  zeroLandings: number;
  /** Rendered frames since the park engaged or the last probe resolved. */
  framesSinceProbe: number;
}

export const INITIAL_PARK_STATE: ParkState = {
  phase: 'active',
  zeroLandings: 0,
  framesSinceProbe: 0,
};

const PARKED_STATE: ParkState = {
  phase: 'parked',
  zeroLandings: 0,
  framesSinceProbe: 0,
};

const PROBING_STATE: ParkState = {
  phase: 'probing',
  zeroLandings: 0,
  framesSinceProbe: 0,
};

/**
 * One rendered frame of the park machine. `landedFresh` is a LIVE landing —
 * a reduction of a frame whose statistic writes were open; the stale
 * readbacks the parked fence keeps issuing never surface as one. The dm
 * comparisons are exact: a frame no term cut measures 0 by construction,
 * and the slew snaps the applied cut onto exactly 0
 * (`scene-adaptation-pure.ts` § slewDm), so neither needs a tolerance.
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
): ParkState {
  if (landedFresh) {
    if (measuredDm < 0 || appliedDm !== 0) return INITIAL_PARK_STATE;
    if (state.phase === 'active') {
      const zeroLandings = state.zeroLandings + 1;
      if (zeroLandings < ADAPT_PARK_ZERO_LANDINGS) {
        return { phase: 'active', zeroLandings, framesSinceProbe: 0 };
      }
    }
    return PARKED_STATE;
  }
  if (state.phase === 'parked') {
    const framesSinceProbe = state.framesSinceProbe + 1;
    if (framesSinceProbe >= ADAPT_PARK_PROBE_INTERVAL_FRAMES) return PROBING_STATE;
    return { phase: 'parked', zeroLandings: 0, framesSinceProbe };
  }
  return state;
}
