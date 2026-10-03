// Hides the cursor after pointer idle; holds a screen wake lock while fullscreen.

export const IDLE_CURSOR_CLASS = 'idle-cursor';
export const IDLE_CURSOR_MS = 2000;

export function bindIdleCursor(signal: AbortSignal): void {
  const root = document.documentElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastX = Number.NaN;
  let lastY = Number.NaN;

  const wake = () => {
    root.classList.remove(IDLE_CURSOR_CLASS);
    clearTimeout(timer);
    timer = setTimeout(() => root.classList.add(IDLE_CURSOR_CLASS), IDLE_CURSOR_MS);
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
    root.classList.remove(IDLE_CURSOR_CLASS);
  }, { once: true });
  wake();
}

type LockState =
  | { readonly kind: 'released' }
  | { readonly kind: 'requesting' }
  | { readonly kind: 'held'; readonly sentinel: WakeLockSentinel };

const RELEASED: LockState = { kind: 'released' };

export function bindFullscreenWakeLock(signal: AbortSignal): void {
  if (!('wakeLock' in navigator)) return;
  const wakeLock = navigator.wakeLock;
  let state: LockState = RELEASED;

  const wanted = () =>
    !signal.aborted && document.fullscreenElement !== null && document.visibilityState === 'visible';

  const release = () => {
    if (state.kind !== 'held') return;
    const { sentinel } = state;
    state = RELEASED;
    sentinel.release().catch(() => {});
  };

  const acquire = async () => {
    if (state.kind !== 'released') return;
    state = { kind: 'requesting' };
    let sentinel: WakeLockSentinel;
    try {
      sentinel = await wakeLock.request('screen');
    } catch {
      state = RELEASED;
      return;
    }
    sentinel.addEventListener('release', () => {
      if (state.kind === 'held' && state.sentinel === sentinel) state = RELEASED;
    }, { once: true });
    state = { kind: 'held', sentinel };
    if (!wanted()) release();
  };

  const reconcile = () => {
    if (wanted()) void acquire();
    else release();
  };

  document.addEventListener('fullscreenchange', reconcile, { signal });
  document.addEventListener('visibilitychange', reconcile, { signal });
  signal.addEventListener('abort', release, { once: true });
  reconcile();
}
