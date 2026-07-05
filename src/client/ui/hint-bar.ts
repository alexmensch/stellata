// Bottom-centre on-screen keyboard-shortcut hint bar: context-essential
// chips from the shared registry; full list behind `?`. Toggle persisted.
// See src/client/ui/README.md § Keyboard-shortcut hint bar.

import type { Stellata } from '../stellata';
import { hintBarShortcuts, type ShortcutState } from './keyboard-shortcuts-registry';

const HINT_BAR_PREF = 'stellata.hint-bar';

export function createHintBar(stellata: Stellata): void {
  const bar = document.getElementById('hint-bar');
  if (!bar) return;

  let enabled = localStorage.getItem(HINT_BAR_PREF) !== 'off';

  const modalOpen = (): boolean => {
    for (const m of document.querySelectorAll<HTMLElement>('.modal')) {
      if (!m.hidden) return true;
    }
    const kb = document.getElementById('kb-modal');
    return !!kb && !kb.hidden;
  };

  const currentState = (): ShortcutState => ({
    cameraMode: stellata.getCameraMode(),
    hasFocus: stellata.getFocusedStar() !== null || stellata.getFocusedCloud() !== null,
    hasDestination: stellata.getVectorTo() !== null || stellata.getVectorToCloud() !== null,
    modalOpen: modalOpen(),
  });

  const render = (): void => {
    bar.hidden = !enabled;
    if (!enabled) return;
    const chips = hintBarShortcuts(currentState()).map((s) => {
      const chip = document.createElement('span');
      chip.className = 'hint-chip';
      chip.textContent = s.keys.join(' ');
      chip.title = s.label;
      return chip;
    });
    bar.replaceChildren(...chips);
  };

  // Recompute on any state that changes the visible set.
  stellata.on('focus', render);
  stellata.on('cloudFocus', render);
  stellata.on('cameraMode', render);
  stellata.on('vector', render);
  stellata.on('vectorCloud', render);

  // Modals toggle `hidden` with no event of their own; watch the attribute.
  const observer = new MutationObserver(render);
  const watch = (el: Element | null): void => {
    if (el) observer.observe(el, { attributes: true, attributeFilter: ['hidden'] });
  };
  watch(document.getElementById('kb-modal'));
  document.querySelectorAll('.modal').forEach(watch);

  const toggleInput = document.getElementById('show-hint-bar') as HTMLInputElement | null;
  if (toggleInput) {
    toggleInput.checked = enabled;
    toggleInput.addEventListener('change', () => {
      enabled = toggleInput.checked;
      localStorage.setItem(HINT_BAR_PREF, enabled ? 'on' : 'off');
      render();
    });
  }

  render();
}
