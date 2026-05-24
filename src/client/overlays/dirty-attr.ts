// Dirty-track helpers for per-frame SVG attribute / textContent /
// inline-style writes; caller-managed sentinel state.
// See docs/authoring-patterns.md § Sentinel-init for dirty-track.

/**
 * Half a .toFixed(1) step — below this, the attribute string round-trips
 * to the same value, so the browser would treat the write as a no-op
 * anyway (after re-parsing). Used as the floor for per-frame DOM attribute
 * writes across the overlay layer at decimals=1 precision. Callers using
 * other precisions automatically get the matched threshold from
 * setNumAttr (`0.5 × 10^-decimals`).
 */
export const ATTR_DIRTY_PX = 0.05;

/**
 * Write `value.toFixed(decimals)` to `el[name]` only when `value` differs
 * from `last` by ≥ the precision floor (half a .toFixed(decimals) step).
 * Returns the new `last` for the caller to store back.
 */
export function setNumAttr(
  el: Element,
  name: string,
  value: number,
  last: number,
  decimals = 1,
): number {
  const threshold = 0.5 * Math.pow(10, -decimals);
  if (Math.abs(value - last) < threshold) return last;
  el.setAttribute(name, value.toFixed(decimals));
  return value;
}

/**
 * Strict-equality variant for string-valued attributes (e.g. `d` path data
 * pre-formatted). Returns the new `last`.
 */
export function setStrAttr(
  el: Element,
  name: string,
  value: string,
  last: string,
): string {
  if (value === last) return last;
  el.setAttribute(name, value);
  return value;
}

/** Write to `el.textContent` only when changed. Returns the new `last`. */
export function setText(
  el: { textContent: string | null },
  value: string,
  last: string,
): string {
  if (value === last) return last;
  el.textContent = value;
  return value;
}

/**
 * Write to `el.style[prop]` only when changed. Returns the new `last`.
 * Initial `last` should be a poison value (`'\0'`) so the first write
 * lands even when the steady-state value happens to match the inline-
 * style default of `''`.
 */
export function setStyle(
  el: { style: CSSStyleDeclaration },
  prop: string,
  value: string,
  last: string,
): string {
  if (value === last) return last;
  (el.style as unknown as Record<string, string>)[prop] = value;
  return value;
}

/**
 * Minimal state shape required by `applyFade`. Caller stores the last-
 * written opacity (init `-Infinity` so the first call's `|alpha − last| >=
 * threshold` gate always trips — NaN poisons the gate in the wrong
 * direction) and the last-written pointer-events string (init `'\0'` so
 * the steady-state `''` value doesn't silently match a freshly-emitted
 * state and skip the first restore-to-clickable write).
 */
export interface FadeState {
  lastOpacity: number;
  lastPointerEvents: string;
}

/** Convenience: returns a FadeState with the canonical poison sentinels. */
export function emptyFadeState(): FadeState {
  return { lastOpacity: -Infinity, lastPointerEvents: '\0' };
}

/**
 * Per-frame fade: write `alpha.toFixed(3)` to every supplied element's
 * inline `opacity` under a single 0.0005-threshold guard (the .toFixed(3)
 * precision floor — half-step matches `setNumAttr`'s default-decimals=3
 * derivation), and toggle `clickableEl`'s inline `pointerEvents` at the
 * 0.5 alpha boundary so labels that fade past half-opacity stop accepting
 * clicks. Shared between hud-overlay (Sol/GC arrows) and distance-vector
 * (vector + warp affordance) so all three reference arrows go through the
 * same dirty-track / pointer-policy contract — though each consumer feeds
 * its own alpha (Sol/GC share one, distance-vector computes its own per
 * the ml8 fix). Mutates `state`.
 */
export function applyFade(
  opacityEls: { style: CSSStyleDeclaration }[],
  clickableEl: { style: CSSStyleDeclaration },
  alpha: number,
  state: FadeState,
): void {
  const threshold = 0.5 * Math.pow(10, -3);
  if (Math.abs(alpha - state.lastOpacity) >= threshold) {
    const a = alpha.toFixed(3);
    for (const el of opacityEls) el.style.opacity = a;
    state.lastOpacity = alpha;
  }
  const pe = alpha >= 0.5 ? '' : 'none';
  state.lastPointerEvents = setStyle(clickableEl, 'pointerEvents', pe, state.lastPointerEvents);
}
