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
export const PINCH_NOTCH_GAIN = 20;

/** Wheel-pixel delta per unit of `ln(scale)`, for the WebKit gesture path —
 *  the balance knob between the two browser pinch reports, since WebKit's
 *  `scale` runs hotter than Blink's wheel delta for the same physical
 *  gesture. Zoom-per-pinch on WebKit is exactly linear in this; Blink is
 *  untouched by it. Set the balance here once, then move `PINCH_NOTCH_GAIN`
 *  to change overall feel without disturbing it. */
export const PINCH_SCALE_DELTA_PX = 50;

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

/** A wheel delta this large is already notch-scale — a real wheel tick, which
 *  `Ctrl` held makes indistinguishable from pinch at the event level. Those
 *  pass through unamplified so `Ctrl`+wheel stays one notch per tick. A
 *  trackpad pinch reports well under this per event. */
export const NOTCH_SCALE_DELTA_PX = 40;

/** Ceiling on notches from a single event. Never binds at a sane gain — 20
 *  notches is already a ~42 % distance change in one frame — but keeps a
 *  mistyped gain from freezing the frame in a dispatch loop. */
export const MAX_NOTCHES_PER_EVENT = 20;

/** Fold one pinch event into whole notch-equivalents, carrying the sub-notch
 *  remainder to the next event so a slow pinch accumulates instead of
 *  rounding to nothing. The returned count is signed and may exceed one:
 *  quantising to ±1 here would silently cap the gain, leaving it inert above
 *  `NOTCH_SCALE_DELTA_PX / PINCH_NOTCH_GAIN` of input. */
export function pinchStep(
  carriedPx: number,
  deltaYPx: number,
): { notches: number; carriedPx: number } {
  const notchScale = Math.abs(deltaYPx) >= NOTCH_SCALE_DELTA_PX;
  const accumulated = carriedPx + (notchScale ? deltaYPx : deltaYPx * PINCH_NOTCH_GAIN);
  const whole = Math.trunc(accumulated / WHEEL_NOTCH_DELTA_PX);
  const notches = Math.max(-MAX_NOTCHES_PER_EVENT, Math.min(MAX_NOTCHES_PER_EVENT, whole));
  return { notches, carriedPx: accumulated - whole * WHEEL_NOTCH_DELTA_PX };
}
