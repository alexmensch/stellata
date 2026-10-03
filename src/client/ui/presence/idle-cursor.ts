// Hides the cursor after IDLE_CURSOR_MS without pointer activity.

export const IDLE_CURSOR_ATTR = 'data-idle-cursor';
export const IDLE_CURSOR_MS = 2000;

type CursorState =
  | { readonly kind: 'shown'; readonly timer: ReturnType<typeof setTimeout> }
  | { readonly kind: 'hidden' };

export function bindIdleCursor(signal: AbortSignal): void {
  const root = document.documentElement;
  let lastActivity = performance.now();
  let lastX = Number.NaN;
  let lastY = Number.NaN;

  const showFor = (ms: number): CursorState => ({ kind: 'shown', timer: setTimeout(expire, ms) });
  let state = showFor(IDLE_CURSOR_MS);

  function expire(): void {
    const remaining = lastActivity + IDLE_CURSOR_MS - performance.now();
    if (remaining > 0) {
      state = showFor(remaining);
      return;
    }
    state = { kind: 'hidden' };
    root.setAttribute(IDLE_CURSOR_ATTR, '');
  }

  const activity = () => {
    lastActivity = performance.now();
    if (state.kind === 'shown') return;
    root.removeAttribute(IDLE_CURSOR_ATTR);
    state = showFor(IDLE_CURSOR_MS);
  };

  window.addEventListener('pointermove', (e) => {
    // see README.md#idle-cursor
    if (e.clientX === lastX && e.clientY === lastY) return;
    lastX = e.clientX;
    lastY = e.clientY;
    activity();
  }, { capture: true, passive: true, signal });
  window.addEventListener('pointerdown', activity, { capture: true, passive: true, signal });
  signal.addEventListener('abort', () => {
    if (state.kind === 'shown') clearTimeout(state.timer);
    else root.removeAttribute(IDLE_CURSOR_ATTR);
  }, { once: true });
}
