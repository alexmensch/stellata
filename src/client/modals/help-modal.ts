// Keyboard-shortcut help modal (the `?` key target). Dismissal via
// modal-dismiss.ts; the shortcut list renders from the shared registry.
// See src/client/ui/README.md § Keyboard shortcuts.

import { bindModalDismissal, type ModalHandle } from './modal-dismiss';
import { helpModalShortcuts } from '../ui/keyboard-shortcuts-registry';

export function bindHelpModal(): ModalHandle {
  const modal = document.getElementById('help-modal')!;
  const list = modal.querySelector<HTMLElement>('.modal-shortcuts');
  if (list) renderShortcutList(list);
  return bindModalDismissal(modal);
}

function renderShortcutList(list: HTMLElement): void {
  const frag = document.createDocumentFragment();
  for (const s of helpModalShortcuts()) {
    const dt = document.createElement('dt');
    // A repeated key ("F F") is a double-tap; distinct keys ("+ / −") are
    // alternatives.
    const sep = s.keys.length === 2 && s.keys[0] === s.keys[1] ? ' ' : ' / ';
    s.keys.forEach((k, i) => {
      if (i > 0) dt.append(sep);
      const kbd = document.createElement('kbd');
      kbd.textContent = k;
      dt.append(kbd);
    });
    const dd = document.createElement('dd');
    dd.textContent = s.label;
    frag.append(dt, dd);
  }
  list.replaceChildren(frag);
}
