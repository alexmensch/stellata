// Classify WHY the render gate is drawing (or not) this moment. Pure, so
// the verdict table is testable. See README.md.

import { SETTLE_MS } from '../../render-gate/render-gate-pure';
import { CADENCE_MIN_IDLE_GAP_REAL_S } from '../../render-gate/clock-cadence-pure';

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

export type RenderWatchTone =
  /** Idling on the cadence, as intended. */
  | 'idling'
  /** Rendering every tick, and that is the specified behaviour here. */
  | 'as-designed'
  /** Rendering for a reason that should expire on its own. */
  | 'transient'
  /** A hold is forcing frames — usually the debug panel. */
  | 'held'
  /** Rendering when the budget says it should not be. */
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
  /** Gaps between consecutive rendered frames, ms, any order. */
  gapsMs: readonly number[];
  rideMoved: boolean;
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
 *  can never name a cause the gate would not have used. */
export function classifyRenderWatch(s: RenderWatchSample): RenderWatchVerdict {
  const rate = Math.abs(s.clockRate);
  const expectedGapMs = rate === 0 ? Number.NaN : (s.budgetSimS * 1000) / rate;
  const medianGapMs = medianOf(s.gapsMs);
  const out = (tone: RenderWatchTone, reason: string): RenderWatchVerdict =>
    ({ tone, reason, expectedGapMs, medianGapMs });
  const ride = s.rideMoved ? ' · focal ride active (budget halved)' : '';

  if (s.holds > 0) {
    return out('held', `HELD OPEN — ${s.holds} hold(s). The debug panel takes one.`);
  }
  if (s.clockRate === 0) {
    return out('as-designed', 'CLOCK PAUSED — the cadence is not what idles here');
  }
  // Both guards that precede the budget test in `clockFrameDue`.
  if (rate > 1) {
    return out('as-designed', `AS DESIGNED — ${s.clockRate}x is past live, never idles${ride}`);
  }
  if (!(s.budgetSimS >= CADENCE_MIN_IDLE_GAP_REAL_S * rate)) {
    return out('as-designed',
      `AS DESIGNED — budget ${s.budgetSimS.toFixed(2)}s under the `
      + `${CADENCE_MIN_IDLE_GAP_REAL_S}s idle floor${ride}`);
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
    return out('idling', `IDLING — one frame per ${(medianGapMs / 1000).toFixed(1)}s${ride}`);
  }
  return out('wrong',
    `NOT IDLING — ${Math.round(medianGapMs)}ms gaps against a `
    + `${(expectedGapMs / 1000).toFixed(2)}s budget`);
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
