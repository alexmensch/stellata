// Hide-controls toggle: reads/writes `body[data-controls-hidden]`, which
// styles.css uses to hide the top-right controls stack (Navigate topbar +
// settings panel) and reveal the corner restore box.

const ATTR = 'data-controls-hidden';

export function isControlsHidden(): boolean {
  return document.body.hasAttribute(ATTR);
}

export function setControlsHidden(hidden: boolean): void {
  document.body.toggleAttribute(ATTR, hidden);
}

export function toggleControlsHidden(): void {
  setControlsHidden(!isControlsHidden());
}

export function bindControlsHideToggle(): void {
  const restoreBtn = document.getElementById('controls-restore-btn');
  restoreBtn?.addEventListener('click', () => setControlsHidden(false));
}
