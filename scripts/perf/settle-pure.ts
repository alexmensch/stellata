// Is the page quiet enough to measure? A verdict over one render-gate
// snapshot. README.md § What a run does.

import { SETTLE_MS } from '../../src/client/render-gate/render-gate-pure';

export interface GateSnapshot {
  readonly now: number;
  readonly holds: number;
  readonly lastActiveMs: number;
  readonly lastWakeReason: string | null;
  readonly transition: boolean;
}

export type StuckOn = 'holds' | 'transition' | 'active';

export type SettleVerdict =
  | { readonly settled: true }
  | { readonly settled: false; readonly stuckOn: StuckOn; readonly detail: string };

export const DEFAULT_QUIET_MS = 5000;

export function settleVerdict(snap: GateSnapshot, quietMs = DEFAULT_QUIET_MS): SettleVerdict {
  if (snap.holds > 0) {
    return { settled: false, stuckOn: 'holds', detail: `${snap.holds} render-gate hold(s) live` };
  }
  if (snap.transition) {
    return { settled: false, stuckOn: 'transition', detail: 'camera transition in flight' };
  }
  const quiet = Math.max(SETTLE_MS, quietMs);
  const idleMs = snap.now - snap.lastActiveMs;
  if (idleMs < quiet) {
    return {
      settled: false,
      stuckOn: 'active',
      detail: `last wake ${Math.round(idleMs)} ms ago (${snap.lastWakeReason ?? 'no reason recorded'}); need ${quiet} ms idle`,
    };
  }
  return { settled: true };
}
