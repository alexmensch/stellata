// Browser Fullscreen API wrapper. Fullscreens `<html>` so the topbar,
// panel, and SVG overlays — everything under `<body>` — stay visible
// inside fullscreen, not just the canvas.

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
