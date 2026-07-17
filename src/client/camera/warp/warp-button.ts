import type { Stellata } from '../../stellata';

// Warp UI wiring. The W key triggers a warp to the current vector
// destination (clicking the distance label aims the camera instead —
// see overlays/distance-vector-overlay.ts). The floating top-center
// pill only shows up during an in-flight warp to offer "Skip", and it
// uses a muted ghost style so it doesn't fight the rest of the chrome.
// Also toggles a body class while a warp is in flight so overlays can
// hide themselves via CSS.
export function bindWarpButton(stellata: Stellata) {
  const btn = document.getElementById('warp-btn') as HTMLButtonElement;

  const render = () => {
    if (stellata.getWarpActive()) {
      btn.hidden = false;
      btn.textContent = 'Skip';
    } else {
      btn.hidden = true;
    }
  };

  btn.addEventListener('click', () => {
    if (stellata.getWarpActive()) stellata.skipWarp();
    btn.blur();
  });

  const triggerWarp = () => {
    const dest = stellata.getVectorTarget();
    if (dest !== null) stellata.warpTo(dest);
  };

  window.addEventListener('keydown', (e) => {
    // Ignore keys typed in search inputs so "w" doesn't trigger warp while
    // the user is typing a star name.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (stellata.getWarpActive()) {
      if (e.key === 'Escape' || e.key === ' ') {
        e.preventDefault();
        stellata.skipWarp();
      }
    } else if (e.key === 'w' || e.key === 'W') {
      if (stellata.getVectorTarget() !== null) {
        e.preventDefault();
        triggerWarp();
      }
    }
  });

  stellata.on('warp', (active) => {
    document.body.classList.toggle('warping', active);
    render();
  });
  render();
}
