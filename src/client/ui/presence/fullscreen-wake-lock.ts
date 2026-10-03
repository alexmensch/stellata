// Holds a best-effort screen wake lock while the page is fullscreen and visible.

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

  const reconcile = () => {
    if (wanted()) void acquire();
    else release();
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
      if (state.kind !== 'held' || state.sentinel !== sentinel) return;
      state = RELEASED;
      reconcile();
    }, { once: true });
    state = { kind: 'held', sentinel };
    if (!wanted()) release();
  };

  document.addEventListener('fullscreenchange', reconcile, { signal });
  document.addEventListener('visibilitychange', reconcile, { signal });
  signal.addEventListener('abort', release, { once: true });
  reconcile();
}
