// Shared open/close machinery for `.modal` elements: `hidden` toggle,
// ESC + `[data-modal-dismiss]` binding, optional `beforeClose` hook.
// See src/client/modals/README.md.

export interface ModalHandle {
  open: () => void;
  close: () => void;
}

export interface ModalOptions {
  /** Run just before `modal.hidden = true`. Returning anything is
   *  ignored — used for side-effects like writing localStorage. */
  beforeClose?: () => void;
}

// ESC dismisses only the top-most (last-opened) modal — with two bound
// modals open at once, one keypress must not close both.
const openStack: HTMLElement[] = [];

export function bindModalDismissal(modal: HTMLElement, opts: ModalOptions = {}): ModalHandle {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !modal.hidden && openStack[openStack.length - 1] === modal) {
      close();
    }
  };
  const open = () => {
    modal.hidden = false;
    if (!openStack.includes(modal)) openStack.push(modal);
    document.addEventListener('keydown', onKey);
  };
  const close = () => {
    if (modal.hidden) return;
    opts.beforeClose?.();
    modal.hidden = true;
    const i = openStack.indexOf(modal);
    if (i !== -1) openStack.splice(i, 1);
    document.removeEventListener('keydown', onKey);
  };
  // Delegated, so dismiss buttons injected after bind time are wired too.
  modal.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-modal-dismiss]')) close();
  });
  return { open, close };
}
