// Normalisation from trackpad-pinch wheel deltas to whole scroll-notch
// equivalents. See README.md § Pinch-to-zoom.

/** One mouse-wheel notch in pixel delta mode. TrackballControls' zoom and
 *  ObserveControls' FOV step are both tuned against this, so re-emitting
 *  pinch input in these units reuses their calibration instead of adding a
 *  second zoom rate to keep in sync. */
export const WHEEL_NOTCH_DELTA_PX = 100;

/** Pinch-delta amplification, applied to BOTH browser pinch paths. A trackpad
 *  pinch reports single-digit `deltaY` per event where a wheel notch reports
 *  100, so unamplified it registers as ~1/30th of a notch and reads as "pinch
 *  does nothing". Sets how many notches a full two-finger pinch is worth. */
export const PINCH_NOTCH_GAIN = 12;

/** Wheel-pixel delta per unit of `ln(scale)`, for the WebKit gesture path —
 *  the balance knob between the two browser pinch reports, since WebKit's
 *  `scale` runs hotter than Blink's wheel delta for the same physical
 *  gesture. Zoom-per-pinch on WebKit is exactly linear in this; Blink is
 *  untouched by it. Set the balance here once, then move `PINCH_NOTCH_GAIN`
 *  to change overall feel without disturbing it. */
export const PINCH_SCALE_DELTA_PX = 200;

/** One step of WebKit's cumulative `GestureEvent.scale`, expressed as the
 *  wheel-pixel delta the `ctrlKey`-wheel path speaks. Spreading a fingers →
 *  scale > 1 → zoom in, matching a negative wheel delta (scroll up).
 *
 *  Safari is the reason this exists: it reports trackpad pinch ONLY through
 *  the non-standard `gesture*` events, never as the `ctrlKey` wheel every
 *  Blink-based browser synthesises. */
export function scaleStepDeltaPx(previousScale: number, scale: number): number {
  if (!(previousScale > 0) || !(scale > 0)) return 0;
  return -Math.log(scale / previousScale) * PINCH_SCALE_DELTA_PX;
}

/** Fold one pinch event into at most one notch-equivalent, carrying the
 *  remainder to the next event.
 *
 *  Per-event contribution is capped at one notch so a genuine Ctrl+wheel notch
 *  (indistinguishable from pinch by design — browsers report both as
 *  `ctrlKey` wheel) zooms by exactly one notch rather than by the gain, and so
 *  the carry can never build a backlog that keeps firing after the fingers
 *  stop. */
export function pinchStep(
  carriedPx: number,
  deltaYPx: number,
): { notch: -1 | 0 | 1; carriedPx: number } {
  const gained = deltaYPx * PINCH_NOTCH_GAIN;
  const contribution = Math.max(
    -WHEEL_NOTCH_DELTA_PX,
    Math.min(WHEEL_NOTCH_DELTA_PX, gained),
  );
  const accumulated = carriedPx + contribution;
  if (accumulated >= WHEEL_NOTCH_DELTA_PX) {
    return { notch: 1, carriedPx: accumulated - WHEEL_NOTCH_DELTA_PX };
  }
  if (accumulated <= -WHEEL_NOTCH_DELTA_PX) {
    return { notch: -1, carriedPx: accumulated + WHEEL_NOTCH_DELTA_PX };
  }
  return { notch: 0, carriedPx: accumulated };
}
