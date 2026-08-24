// Classify WHY the render gate is drawing (or not) this moment. Pure, so
// the verdict table is testable. See README.md.

import { SETTLE_MS } from '../../render-gate/render-gate-pure';
import {
  CADENCE_CAP_SIM_S,
  CADENCE_JND_FLUX_FRAC,
  CADENCE_MOTION_THRESHOLD_DEVICE_PX,
  type CadenceReport,
} from '../../render-gate/cadence/clock-cadence-pure';
import type { CadenceViolation } from '../../render-gate/cadence/cadence-trust-pure';

/** A tail that has been continuously unexpired for this long is not
 *  settling — something is stamping activity every tick. The focal ride
 *  did exactly that until it was absorbed
 *  (`../../render-gate/README.md` § The focal ride), and it presented as
 *  a settle tail that never ran out. Three tails' worth: long enough that
 *  no real burst of invalidation reaches it. */
export const STUCK_TAIL_MS = SETTLE_MS * 3;

/** Fraction of the expected gap a measured median may fall short by and
 *  still count as idling on schedule. Absorbs one tick of quantisation. */
const IDLE_TOLERANCE = 0.7;

/** Gaps kept for the median.
 *
 *  A COUNT, not a wall-clock window, and that is one of the three fixes
 *  this instrument needed: a 120 s window meant one interaction left two
 *  minutes of 16 ms gaps in the sample, so the median read NOT IDLING for
 *  two minutes after every touch — and `medianOf` sorted a ~7200-element
 *  array five times a second while it did. Thirty-two gaps is several
 *  minutes of real idling and a sort nobody can measure. */
export const GAP_SAMPLE_COUNT = 32;

/** The HUD container's inline style.
 *
 *  `pointer-events: auto` is what makes the readout selectable, and it
 *  also protects the measurement rather than threatening it: the gate's
 *  wake listeners sit on the CANVAS, so `none` would pass every pointer
 *  move in this corner straight through to it and wake the gate the HUD
 *  is watching. Absorbing them is the quiet option.
 *
 *  Selection opt-in follows the panel's pattern — `body` sets
 *  `user-select: none` and UI chrome opts back in, with the `-webkit-`
 *  property set explicitly because Safari does not reliably inherit it
 *  (`../../styles.css`). */
export function hudContainerCss(): string {
  return 'position:fixed;top:10px;left:10px;z-index:99999;'
    + 'pointer-events:auto;user-select:text;-webkit-user-select:text;cursor:text;'
    + 'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;'
    + 'background:rgba(0,0,0,.85);color:#e8e8e8;padding:9px 11px;'
    + 'border-radius:6px;border:2px solid #333;min-width:350px';
}

export type RenderWatchTone =
  /** Idling on the cadence, as intended. */
  | 'idling'
  /** Rendering every tick, and that is the specified behaviour here. */
  | 'as-designed'
  /** Rendering for a reason that should expire on its own. */
  | 'transient'
  /** A hold is forcing frames — usually the debug panel. */
  | 'held'
  /** Rendering when the budget says it should not be, or a declaration
   *  turned out to be wrong. */
  | 'wrong'
  /** Not enough samples yet. */
  | 'unknown';

export interface RenderWatchSample {
  holds: number;
  clockRate: number;
  budgetSimS: number;
  /** Wall-clock ms since the gate last stamped activity. */
  msSinceWake: number;
  /** How long the settle tail has been continuously unexpired. */
  tailHeldMs: number;
  /** Gaps between consecutive rendered frames, ms, any order. At most
   *  `GAP_SAMPLE_COUNT` of them, and none from before the last wake. */
  gapsMs: readonly number[];
  /** The safety net's standing correction, 1 when nothing has
   *  under-reported. */
  trust: number;
  /** The last declaration that turned out to be wrong, if any. */
  violation: CadenceViolation | null;
}

export interface RenderWatchVerdict {
  tone: RenderWatchTone;
  reason: string;
  /** Gap the budget implies, in ms — NaN when the clock is paused. */
  expectedGapMs: number;
  /** Median measured gap, ms. NaN with fewer than two samples. */
  medianGapMs: number;
}

export function medianOf(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/** The verdict, in the render gate's OWN decision order (holds, then the
 *  continuous conditions, then the cadence, then the tail) so the readout
 *  can never name a cause the gate would not have used.
 *
 *  A live safety-net correction outranks all of it, because a shortened
 *  budget explains a frame rate that would otherwise read as the estimator
 *  being wrong about the scene — and a net that quietly absorbed a wrong
 *  declaration would be worse than no net at all. */
export function classifyRenderWatch(s: RenderWatchSample): RenderWatchVerdict {
  const rate = Math.abs(s.clockRate);
  const expectedGapMs = rate === 0 ? Number.NaN : (s.budgetSimS * 1000) / rate;
  const medianGapMs = medianOf(s.gapsMs);
  const out = (tone: RenderWatchTone, reason: string): RenderWatchVerdict =>
    ({ tone, reason, expectedGapMs, medianGapMs });

  if (s.trust < 1 && s.violation !== null) {
    return out('wrong',
      `DECLARATION UNDER-REPORTED — ${s.violation.channel} moved `
      + `${s.violation.observed.toPrecision(3)} against ${s.violation.allowed} allowed. `
      + `Budget held at 1/${Math.round(1 / s.trust)} until it stops.`);
  }
  if (s.holds > 0) {
    return out('held', `HELD OPEN — ${s.holds} hold(s). The debug panel takes one.`);
  }
  if (s.clockRate === 0) {
    return out('as-designed', 'CLOCK PAUSED — the cadence is not what idles here');
  }
  if (rate > 1) {
    return out('as-designed', `AS DESIGNED — ${s.clockRate}x is past live, never idles`);
  }
  if (s.msSinceWake < SETTLE_MS) {
    if (s.tailHeldMs >= STUCK_TAIL_MS) {
      return out('wrong',
        `TAIL NEVER EXPIRES — ${(s.tailHeldMs / 1000).toFixed(0)}s of unbroken `
        + 'activity stamps. Something wakes the gate every tick.');
    }
    return out('transient', `SETTLE TAIL — woken ${Math.round(s.msSinceWake)}ms ago`);
  }
  if (s.gapsMs.length < 2) {
    return out('unknown',
      `collecting — needs ~${Math.ceil((expectedGapMs / 1000) * 3)}s`);
  }
  if (medianGapMs >= expectedGapMs * IDLE_TOLERANCE) {
    return out('idling', `IDLING — one frame per ${(medianGapMs / 1000).toFixed(1)}s`);
  }
  return out('wrong',
    `NOT IDLING — ${Math.round(medianGapMs)}ms gaps against a `
    + `${(expectedGapMs / 1000).toFixed(2)}s budget`);
}

/** Which of the four budget sources is setting the hold, named for the
 *  readout. Resolved in the order `cadenceSimBudgetS` takes its `Math.min`
 *  in, so the label cannot disagree with the number beside it. */
export function bindingSourceLabel(
  report: CadenceReport,
  pulsationBudgetS: number,
  pixelRatio: number,
): string {
  const motion = report.screenPxPerSimS * Math.max(pixelRatio, 1);
  const motionS = motion > 0
    ? CADENCE_MOTION_THRESHOLD_DEVICE_PX / motion : Number.POSITIVE_INFINITY;
  const fluxS = report.fluxFracPerSimS > 0
    ? CADENCE_JND_FLUX_FRAC / report.fluxFracPerSimS : Number.POSITIVE_INFINITY;
  if (motionS <= Math.min(fluxS, pulsationBudgetS, CADENCE_CAP_SIM_S)) {
    return 'on-screen motion';
  }
  if (fluxS <= Math.min(pulsationBudgetS, CADENCE_CAP_SIM_S)) return 'a brightness ramp';
  if (pulsationBudgetS <= CADENCE_CAP_SIM_S) return 'the pulsation bound';
  return `the ${CADENCE_CAP_SIM_S}s cap`;
}

/** The observed channels, converted to the per-sim-second units the rate
 *  channels are already in, so the two rows sit directly against each
 *  other. `CadenceReport`'s observations are per GAP — the interval
 *  between the last two rendered frames — and printing them beside a rate
 *  without this reads as the declaration over-reporting by whatever the
 *  frame interval happens to be. NaN gap (nothing rendered yet) and a
 *  zero-length gap both give NaN rather than Infinity, which the readout
 *  prints as a dash. */
export function observedAsRate(observed: number, simDtS: number): number {
  return Number.isFinite(simDtS) && simDtS !== 0 ? observed / Math.abs(simDtS) : Number.NaN;
}

export interface RenderWatchHealth {
  tickHz: number;
  skipRatio: number;
  hitches: number;
  worstGapMs: number;
}

/** The confound line: whether a low tick rate is expensive frames or a
 *  browser deferring the loop. The skip ratio separates them — the gate
 *  skipping nothing while ticks are slow can only be frame cost. */
export function classifyHealth(h: RenderWatchHealth): string {
  const parts: string[] = [];
  if (h.skipRatio > 0.5 && h.tickHz > 0 && h.tickHz < 20) {
    parts.push('browser is deferring the rAF loop — refocus the window');
  } else if (h.skipRatio < 0.02 && h.tickHz > 0 && h.tickHz < 40) {
    parts.push(`cost: ~${Math.round(1000 / h.tickHz)}ms frames, not the gate`);
  }
  if (h.hitches > 0) {
    parts.push(`${h.hitches} hitches >100ms, worst ${Math.round(h.worstGapMs)}ms`);
  }
  return parts.join(' · ');
}
