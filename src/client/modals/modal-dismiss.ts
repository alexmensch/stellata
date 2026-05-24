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

export function bindModalDismissal(modal: HTMLElement, opts: ModalOptions = {}): ModalHandle {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  };
  const open = () => {
    modal.hidden = false;
    document.addEventListener('keydown', onKey);
  };
  const close = () => {
    if (modal.hidden) return;
    opts.beforeClose?.();
    modal.hidden = true;
    document.removeEventListener('keydown', onKey);
  };
  modal.querySelectorAll<HTMLElement>('[data-modal-dismiss]').forEach((el) => {
    el.addEventListener('click', close);
  });
  return { open, close };
}
