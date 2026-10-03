// Hides the cursor after IDLE_CURSOR_MS without pointer activity.

export const IDLE_CURSOR_ATTR = 'data-idle-cursor';
export const IDLE_CURSOR_MS = 2000;

export function bindIdleCursor(signal: AbortSignal): void {
  const root = document.documentElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastX = Number.NaN;
  let lastY = Number.NaN;

  const wake = () => {
    root.removeAttribute(IDLE_CURSOR_ATTR);
    clearTimeout(timer);
    timer = setTimeout(() => root.setAttribute(IDLE_CURSOR_ATTR, ''), IDLE_CURSOR_MS);
  };

  window.addEventListener('pointermove', (e) => {
    // see README.md#idle-cursor
    if (e.clientX === lastX && e.clientY === lastY) return;
    lastX = e.clientX;
    lastY = e.clientY;
    wake();
  }, { capture: true, passive: true, signal });
  window.addEventListener('pointerdown', wake, { capture: true, passive: true, signal });
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    root.removeAttribute(IDLE_CURSOR_ATTR);
  }, { once: true });
  wake();
}
