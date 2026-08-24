// The adaptation measurement's park: the per-rendered-frame state machine
// deciding when the reduction draws and the statistic writes may stop.
// See README.md.

import { ADAPT_SLEW_SETTLE_MAG, type AdaptationRegime } from '../scene-adaptation-pure';

/** Consecutive landed measurements whose cut the measurement does not set,
 *  with the applied cut settled there, before the measurement parks. */
export const ADAPT_PARK_SETTLED_LANDINGS = 3;

/** Rendered frames between wake probes while parked. Detection of a scene
 *  turning bright is bounded by this many rendered frames, the wait for a
 *  frame the chain can draw on, and the slew. */
export const ADAPT_PARK_PROBE_INTERVAL_FRAMES = 6;

/** Each phase carries its own counter and no other: a streak of parkable
 *  landings while active, the probe interval while parked, nothing while a
 *  probe is in flight. */
export type ParkState =
  | { readonly phase: 'active'; readonly settledLandings: number }
  | { readonly phase: 'parked'; readonly framesSinceProbe: number }
  | { readonly phase: 'probing' };

export type ParkPhase = ParkState['phase'];

export const INITIAL_PARK_STATE: ParkState = { phase: 'active', settledLandings: 0 };

const PARKED_STATE: ParkState = { phase: 'parked', framesSinceProbe: 0 };

const PROBING_STATE: ParkState = { phase: 'probing' };

/** One rendered frame's evidence, as the park machine reads it. */
export interface ParkLanding {
  /** A LIVE landing — a reduction of a frame whose statistic writes were
   *  open. The stale readbacks the parked fence keeps issuing never surface
   *  as one. */
  fresh: boolean;
  /** This frame's measurement, and the slew-limited cut actually applied. */
  measuredDm: number;
  appliedDm: number;
  /** Which term set the measured cut. */
  regime: AdaptationRegime;
  /** The reduction has no readback in flight, so a probe opened this frame
   *  draws on this frame. */
  probeReady: boolean;
}

/** No cut, to the exposure subsystem's own resolution — `ADAPT_SLEW_SETTLE_MAG`
 *  borrowed rather than re-picked. Legitimate here because the question IS
 *  numerical ("is this cut zero to our own resolution"); the render gate
 *  asks a perceptual one and must not borrow it
 *  (`../../render-gate/README.md`). `slewDm` collapses a within-band-of-zero
 *  park to exactly 0, but a cut may PARK anywhere inside the band of a
 *  non-zero measurement — an exact test would refuse to park at any such
 *  vantage, leaving the measurement running at full cost for a cut the
 *  render gate will not repaint for. */
function noCut(dm: number): boolean {
  return Math.abs(dm) <= ADAPT_SLEW_SETTLE_MAG;
}

/**
 * Whether a landing's cut is set by something other than the measurement, so
 * a measurement that stops arriving cannot change it. Two cases, and the
 * generalisation over them is the whole reason this is a predicate rather
 * than a test for zero:
 *
 * - **No cut.** Nothing asked for one, so nothing is being applied.
 * - **The display floor governs.** `floor = −2.5·log10(Lw / L_ADAPT)` reads
 *   the operator's white point and the adaptation anchor and nothing from the
 *   frame, so where it wins the applied cut is a CONSTANT while it keeps
 *   winning. It wins exactly where the pin's weight is zero and `eye ≤
 *   floor`, i.e. where `L̄ ≥ Lw` — and skipping emitter writes can only
 *   LOWER `L̄`, since light is additive and non-negative. A parked frame that
 *   measured the floor therefore keeps measuring it.
 *
 * The settled test is on the DIFFERENCE rather than on each cut separately:
 * a floor-governed cut parks at the floor, not at zero, so "both read no
 * cut" cannot express it. Equivalent for the no-cut case, where `slewDm`
 * has already collapsed the applied cut to exactly 0.
 */
function parkable(landing: ParkLanding): boolean {
  if (Math.abs(landing.measuredDm - landing.appliedDm) > ADAPT_SLEW_SETTLE_MAG) return false;
  return noCut(landing.measuredDm) || landing.regime === 'floor';
}

/**
 * One rendered frame of the park machine.
 *
 * A fresh landing outranks everything: any evidence that the measurement is
 * setting the cut returns to active immediately, wherever it arrives —
 * including a request still in flight when the park engaged.
 */
export function parkTick(state: ParkState, landing: ParkLanding): ParkState {
  if (landing.fresh) {
    if (!parkable(landing)) return INITIAL_PARK_STATE;
    if (state.phase === 'active') {
      const settledLandings = state.settledLandings + 1;
      if (settledLandings < ADAPT_PARK_SETTLED_LANDINGS) {
        return { phase: 'active', settledLandings };
      }
    }
    return PARKED_STATE;
  }
  if (state.phase === 'parked') {
    const framesSinceProbe = state.framesSinceProbe + 1;
    // Past the interval the machine waits for a drawable frame rather than
    // opening the writes on one the chain will sit out: the writes would be
    // paid with nothing reducing what they wrote.
    if (framesSinceProbe >= ADAPT_PARK_PROBE_INTERVAL_FRAMES && landing.probeReady) {
      return PROBING_STATE;
    }
    return { phase: 'parked', framesSinceProbe };
  }
  return state;
}

/** A hold freezes the machine, and collapses a probe in flight back to
 *  parked so every dwell of a frame-cost sweep prices the same state. */
export function parkUnderHold(state: ParkState): ParkState {
  return state.phase === 'probing' ? PARKED_STATE : state;
}
