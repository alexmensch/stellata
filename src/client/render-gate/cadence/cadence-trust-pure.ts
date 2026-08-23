// The cadence safety net: audit each scheduled frame against what the
// budget promised, and shorten the budget when a declaration was wrong.
// See README.md § The safety net.

import {
  CADENCE_JND_FLUX_FRAC,
  CADENCE_MOTION_THRESHOLD_DEVICE_PX,
  CADENCE_SAFETY_FACTOR,
} from './clock-cadence-pure';

/** How far past the scheduling threshold an observation may land before
 *  the declaration counts as wrong.
 *
 *  Set to the safety factor, which places the violation line exactly at
 *  `CADENCE_VISIBLE_STEP_DEVICE_PX`: the net fires if and only if
 *  something moved a step a viewer could have SEEN between two rendered
 *  frames. Anything smaller is inside the margin the factor bought and is
 *  not worth a report — including the one tick of overshoot the `>=` due
 *  test allows, and the difference between a secant velocity over the last
 *  step and the tangent at its end. */
export const CADENCE_TRUST_TOLERANCE = CADENCE_SAFETY_FACTOR;

/** Budget multiplier applied on each violation. Halving is enough to
 *  correct a 2x modelling error in one step and a 10x one in four
 *  scheduled frames, which is what "one late frame, not a freeze" means
 *  in practice. */
export const CADENCE_TRUST_BACKOFF = 0.5;

/** Floor on the standing correction. At 1/64 a 30 s cap is a 0.47 s gap —
 *  still idle, and low enough that no realistic under-report survives it.
 *  A floor rather than zero because collapsing to continuous rendering
 *  would hide the diagnosis behind a frame rate that looks fine. */
export const CADENCE_TRUST_FLOOR = 1 / 64;

/** Multiplier applied per clean scheduled frame while recovering. From
 *  the floor that is 19 clean frames back to full trust — slow enough
 *  that a driver violating every few frames stays suppressed, fast enough
 *  that a one-off (a clock jump landing mid-eclipse) costs seconds. */
export const CADENCE_TRUST_RECOVER = 1.25;

export interface CadenceTrustState {
  /** Standing budget multiplier, `CADENCE_TRUST_FLOOR`..1. */
  readonly trust: number;
  /** The most recent violation, for the render watcher to name. Null
   *  until one happens; kept after recovery so the diagnosis survives. */
  readonly lastViolation: CadenceViolation | null;
  /** Scheduled frames audited since the last violation. */
  readonly cleanFrames: number;
}

export interface CadenceViolation {
  /** Which promise broke. */
  readonly channel: 'motion' | 'brightness';
  /** What actually happened — device px, or fraction of flux. */
  readonly observed: number;
  /** The line it crossed, same unit. */
  readonly allowed: number;
  /** Trust immediately after the violation. */
  readonly trust: number;
}

export const CADENCE_TRUST_INITIAL: CadenceTrustState = {
  trust: 1,
  lastViolation: null,
  cleanFrames: 0,
};

export interface CadenceAudit {
  /** Only a frame the CADENCE scheduled says anything about the budget.
   *  On a frame the gate drew for any other reason — a camera move, a
   *  hold, the settle tail, a fast-forward rate — content legitimately
   *  moves further than the threshold, and auditing it would report the
   *  gate doing its job as a fault. */
  readonly cadenceScheduled: boolean;
  /** Largest on-screen displacement anything drawn underwent since the
   *  last rendered frame, CSS px (`CadenceReport.observedPx`). */
  readonly observedPx: number;
  /** Largest fractional-flux change over the same interval. */
  readonly observedFluxFrac: number;
  readonly pixelRatio: number;
}

/** Fold one scheduled frame's observations into the standing correction.
 *
 *  The promise being audited is the gate's own: between two rendered
 *  frames, nothing drawn moves further than
 *  `CADENCE_MOTION_THRESHOLD_DEVICE_PX` or changes brightness by more
 *  than `CADENCE_JND_FLUX_FRAC`. That is checkable directly against what
 *  happened, with no need to reconstruct which layer promised what — and
 *  it catches the failure the accurate estimator introduces, a term
 *  missing from a rate, without trusting the same arithmetic that
 *  produced the rate. */
export function auditCadenceFrame(
  state: CadenceTrustState,
  audit: CadenceAudit,
): CadenceTrustState {
  if (!audit.cadenceScheduled) return state;
  const observedDevicePx = audit.observedPx * Math.max(audit.pixelRatio, 1);
  const motionLine = CADENCE_MOTION_THRESHOLD_DEVICE_PX * CADENCE_TRUST_TOLERANCE;
  const fluxLine = CADENCE_JND_FLUX_FRAC * CADENCE_TRUST_TOLERANCE;
  // `>` per channel, so a NaN observation is not a violation: it would
  // otherwise pin trust at the floor with nothing wrong.
  const channel: CadenceViolation['channel'] | null =
    observedDevicePx > motionLine ? 'motion'
      : audit.observedFluxFrac > fluxLine ? 'brightness'
        : null;
  if (channel === null) {
    return {
      trust: Math.min(1, state.trust * CADENCE_TRUST_RECOVER),
      lastViolation: state.lastViolation,
      cleanFrames: state.cleanFrames + 1,
    };
  }
  const trust = Math.max(CADENCE_TRUST_FLOOR, state.trust * CADENCE_TRUST_BACKOFF);
  return {
    trust,
    lastViolation: {
      channel,
      observed: channel === 'motion' ? observedDevicePx : audit.observedFluxFrac,
      allowed: channel === 'motion' ? motionLine : fluxLine,
      trust,
    },
    cleanFrames: 0,
  };
}
