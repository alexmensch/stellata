// Heuristic for the mobile / small-screen advisory splash — no true
// keyboard-absent signal exists, so approximate from viewport + touch.
// See src/client/modals/README.md § Mobile advisory.

/** Viewport width (px) below which the advisory is a candidate — roughly
 *  the iPad-mini boundary. */
export const MOBILE_ADVISORY_MAX_WIDTH = 768;

export interface MobileAdvisorySignals {
  width: number;
  coarsePointer: boolean;
  hasTouch: boolean;
  /** False when pointer/touch media queries are unavailable — then the
   *  decision falls back to viewport width alone. */
  signalsAvailable: boolean;
  threshold?: number;
}

export function shouldAdviseMobile(s: MobileAdvisorySignals): boolean {
  const threshold = s.threshold ?? MOBILE_ADVISORY_MAX_WIDTH;
  if (s.width >= threshold) return false;
  if (!s.signalsAvailable) return true;
  return s.coarsePointer && s.hasTouch;
}
