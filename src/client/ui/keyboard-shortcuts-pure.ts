// Tap-timing and trim-stepping helpers for keyboard-shortcuts.ts — DOM-
// and Stellata-free so the production binding and the vitest suite share a
// single source of truth.

import { EV_STEP_STOPS } from '../hdr/exposure/exposure-epoch';

/** Window inside which three D presses count as a triple-tap. */
export const D_TRIPLE_TAP_MS = 500;
/** Number of D taps that fire the hidden debug-panel affordance. */
export const D_TRIPLE_TAP_COUNT = 3;

/** Window inside which two presses count as a double-tap (C picker
 *  toggle, F fullscreen). */
export const DOUBLE_TAP_MS = 200;
export const DOUBLE_TAP_COUNT = 2;

/**
 * Push a tap timestamp into a mutable rolling window, drop expired
 * entries, and report whether the window now contains enough taps to
 * fire. When it does, the window is cleared so the next tap starts a
 * fresh count rather than chaining (4th tap doesn't refire — the next
 * triple-tap needs three fresh presses).
 *
 * Pulled out for testability — the production caller in
 * `keyboard-shortcuts.ts` passes `performance.now()`; tests pass a
 * controlled clock.
 */
export function pushTapAndCheckTriple(
  taps: number[],
  now: number,
  windowMs: number = D_TRIPLE_TAP_MS,
  count: number = D_TRIPLE_TAP_COUNT,
): boolean {
  while (taps.length > 0 && now - taps[0] > windowMs) {
    taps.shift();
  }
  taps.push(now);
  if (taps.length >= count) {
    taps.length = 0;
    return true;
  }
  return false;
}

/**
 * The EV trim `deltaSteps` grid stops away from `ev`, snapping onto the
 * grid on the way — so a value that arrived off it (a hand-edited URL)
 * returns to the step the slider and the URL field share instead of
 * carrying its offset forward. Range clamping is
 * `ExposureController.setEv`'s.
 */
export function steppedEv(ev: number, deltaSteps: number): number {
  return (Math.round(ev / EV_STEP_STOPS) + deltaSteps) * EV_STEP_STOPS;
}

/**
 * Single-tap / double-tap gate. The returned `press` schedules `onSingle`
 * after `windowMs`; a second `press` inside that window cancels it and
 * fires `onDouble` instead. Shared by the C (picker / master-toggle) and F
 * (find / fullscreen) shortcuts, which need identical deferral so a second
 * press can intercept the first.
 */
export function makeDoubleTapGate(
  onSingle: () => void,
  onDouble: () => void,
  windowMs: number = DOUBLE_TAP_MS,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      onDouble();
    } else {
      timer = setTimeout(() => {
        timer = null;
        onSingle();
      }, windowMs);
    }
  };
}
