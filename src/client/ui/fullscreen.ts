// Browser Fullscreen API wrapper. Fullscreens `<html>` so the topbar,
// panel, and SVG overlays — everything under `<body>` — stay visible
// inside fullscreen by default, not just the canvas.

const ACTIVE_LABEL = 'exit fullscreen';
const INACTIVE_LABEL = 'fullscreen';

export function isFullscreenActive(): boolean {
  return document.fullscreenElement !== null;
}

export function toggleFullscreen(): void {
  if (isFullscreenActive()) {
    void document.exitFullscreen();
  } else {
    void document.documentElement.requestFullscreen();
  }
}

/** Exit fullscreen if active. Returns whether it was active, so a
 *  caller can bail out of further Esc handling on the same keystroke. */
export function exitFullscreenIfActive(): boolean {
  if (!isFullscreenActive()) return false;
  void document.exitFullscreen();
  return true;
}

export function bindFullscreenToggle(): void {
  const btn = document.getElementById('brand-fullscreen') as HTMLButtonElement | null;
  if (!btn) return;
  const sync = () => {
    btn.textContent = isFullscreenActive() ? ACTIVE_LABEL : INACTIVE_LABEL;
  };
  btn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', sync);
  sync();
}
