// Hide-chrome toggle: reads/writes `body[data-chrome-hidden]`, which
// styles.css uses to hide everything but the canvas and scale bar.

const ATTR = 'data-chrome-hidden';

export function isChromeHidden(): boolean {
  return document.body.hasAttribute(ATTR);
}

export function setChromeHidden(hidden: boolean): void {
  document.body.toggleAttribute(ATTR, hidden);
}

export function toggleChromeHidden(): void {
  setChromeHidden(!isChromeHidden());
}

export function bindChromeHideToggle(): void {
  const toggleBtn = document.getElementById('brand-hide-chrome');
  const restoreBtn = document.getElementById('chrome-restore-btn');
  toggleBtn?.addEventListener('click', toggleChromeHidden);
  restoreBtn?.addEventListener('click', () => setChromeHidden(false));
}
