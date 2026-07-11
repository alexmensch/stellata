// Collapse/expand toggles for the settings panel (top-level + per-group).
// See src/client/ui/README.md § Per-group collapse in the settings panel.

const PANEL_KEY = 'stellata.panel-collapsed';
const GROUP_KEY_PREFIX = 'stellata.group-collapsed.';

export interface CollapseOptions {
  container: HTMLElement;
  header: HTMLElement;
  toggle: HTMLButtonElement;
  storageKey: string;
  /** aria-label subject ("settings" → "Collapse settings"). Omit to keep
   *  the toggle's static aria-label. */
  ariaSubject?: string;
}

/** Header-click collapse with localStorage persistence — the shared
 *  affordance behind the settings panel, its groups, and the focus card. */
export function bindCollapse(o: CollapseOptions) {
  const apply = (c: boolean) => {
    o.container.classList.toggle('collapsed', c);
    o.toggle.textContent = c ? '+' : '−';
    o.toggle.setAttribute('aria-expanded', c ? 'false' : 'true');
    if (o.ariaSubject) {
      o.toggle.setAttribute(
        'aria-label',
        c ? `Expand ${o.ariaSubject}` : `Collapse ${o.ariaSubject}`,
      );
    }
  };

  apply(localStorage.getItem(o.storageKey) === '1');
  o.header.addEventListener('click', () => {
    const next = !o.container.classList.contains('collapsed');
    apply(next);
    localStorage.setItem(o.storageKey, next ? '1' : '0');
  });
}

export function bindPanelLayout() {
  bindTopLevel();
  bindGroups();
}

function bindTopLevel() {
  bindCollapse({
    container: document.getElementById('panel')!,
    header: document.getElementById('panel-header')!,
    toggle: document.getElementById('panel-toggle') as HTMLButtonElement,
    storageKey: PANEL_KEY,
    ariaSubject: 'settings',
  });
}

function bindGroups() {
  const groups = document.querySelectorAll<HTMLElement>('.group[data-group]');
  for (const group of Array.from(groups)) {
    const header = group.querySelector<HTMLElement>('.group-header');
    const toggle = group.querySelector<HTMLButtonElement>('.group-toggle');
    if (!header || !toggle) continue;
    bindCollapse({
      container: group,
      header,
      toggle,
      storageKey: GROUP_KEY_PREFIX + group.dataset.group!,
    });
  }
}
