import type { Stellata } from '../stellata';
import { FOCUS_RING_RADIUS_PX } from './focus-ring-overlay';

// Universal click feedback: every canvas click ripples a ring out from
// the click point to the standard POI-ring radius, then collapses it
// back while fading. A click that persisted something gets its own
// lasting feedback (POI ring, vector, focus); a click that didn't
// (empty sky, Sol, POI cap) leaves nothing behind — the collapse IS the
// "nothing stuck" signal. Replaces toast-style reject messaging.

export const RIPPLE_EXPAND_MS = 160;
export const RIPPLE_COLLAPSE_MS = 220;
export const RIPPLE_MAX_RADIUS_PX = FOCUS_RING_RADIUS_PX;
const RIPPLE_PEAK_OPACITY = 0.9;

export interface RippleFrame {
  radius: number;
  opacity: number;
}

/** Radius/opacity of a ripple `elapsedMs` after its click, or null once
 *  the animation has finished. Expansion eases out; collapse eases in
 *  while the stroke fades. */
export function rippleFrameAt(elapsedMs: number): RippleFrame | null {
  const e = Math.max(0, elapsedMs);
  if (e < RIPPLE_EXPAND_MS) {
    const t = e / RIPPLE_EXPAND_MS;
    const ease = 1 - (1 - t) * (1 - t);
    return { radius: RIPPLE_MAX_RADIUS_PX * ease, opacity: RIPPLE_PEAK_OPACITY };
  }
  const t = (e - RIPPLE_EXPAND_MS) / RIPPLE_COLLAPSE_MS;
  if (t >= 1) return null;
  return {
    radius: RIPPLE_MAX_RADIUS_PX * (1 - t * t),
    opacity: RIPPLE_PEAK_OPACITY * (1 - t),
  };
}

export function createClickRipple(stellata: Stellata): void {
  const group = document.getElementById('click-ripples') as unknown as SVGGElement | null;
  if (!group) return;

  interface ActiveRipple {
    el: SVGCircleElement;
    startMs: number;
  }
  const free: SVGCircleElement[] = [];
  const active: ActiveRipple[] = [];

  stellata.on('canvasClick', ({ x, y }) => {
    let el = free.pop();
    if (!el) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'circle') as SVGCircleElement;
      el.setAttribute('class', 'poi-ring click-ripple');
      group.appendChild(el);
    }
    el.setAttribute('cx', x.toFixed(1));
    el.setAttribute('cy', y.toFixed(1));
    el.setAttribute('r', '0');
    el.style.display = '';
    active.push({ el, startMs: performance.now() });
  });

  // No dirty-tracking: the active set is empty on idle frames (single
  // length check) and a live ripple's radius/opacity change every frame
  // by construction.
  stellata.on('frame', () => {
    if (active.length === 0) return;
    const now = performance.now();
    for (let i = active.length - 1; i >= 0; i--) {
      const a = active[i];
      const f = rippleFrameAt(now - a.startMs);
      if (!f) {
        a.el.style.display = 'none';
        free.push(a.el);
        active.splice(i, 1);
        continue;
      }
      a.el.setAttribute('r', f.radius.toFixed(2));
      a.el.style.opacity = f.opacity.toFixed(3);
    }
  });
}
